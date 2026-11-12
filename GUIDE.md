# Building a TypeScript backend from zero

This repository is a finished example of a production-shaped TypeScript API. It exists to be
**read and copied**, not admired. This document walks the same path you would take starting from
an empty folder, explaining *why* each decision was made so you can reproduce the reasoning in
your own project rather than just copying files.

The domain is deliberately boring — an animal shelter — because the domain is never the hard part.

---

## What the finished system does

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | rate-limited | issues a JWT |
| `GET` | `/auth/me` | Bearer | returns the caller |
| `GET` | `/pets` | public | filtered, paginated |
| `GET` | `/pets/:id` | Bearer | includes nested medical record |
| `GET` | `/health/live` | none | liveness, never touches dependencies |
| `GET` | `/health/ready` | none | readiness; `503` when Postgres is unreachable |

Reads are cached in **Redis**; every cached response carries an `X-Cache: HIT | MISS | SKIP` header
so you can observe the cache in `curl`.

Logins are published as **audit events** to **RabbitMQ** and persisted to an `audit_events` table by
a background consumer. Broker failures never break the request path.

Stack: **Express 5 + TypeScript (ESM) + PostgreSQL 16 via `pg`**, plus JWT auth, rate limiting,
Redis caching, RabbitMQ messaging, a non-root multi-stage **Docker** image, and a **Compose** stack
fronted by **nginx**.

```
Dockerfile                     multi-stage build → distroless-ish runtime (non-root)
.dockerignore                  keeps secrets, tests, and build output out of the context
.github/workflows/ci.yml       install → lint → typecheck → unit → coverage → build
compose.yaml                   app replicas + Postgres + Redis + RabbitMQ + nginx
nginx.conf                     reverse proxy / load balancer (http-context include)
README.md                      quick start, env/API reference, testing and CI summary
.env.example                   committed local-dev env (copy to .env)
ex_ty.env.example              committed dev-only container env (copy to ex_ty.env)
ex_ty.env                      container-only env (service hostnames; git-ignored)
jest.config.mjs                unit + integration projects
jest.coverage.config.mjs       single-project coverage run + thresholds
src/
├── config/env.ts              validated, boot-time config (incl. LOG_LEVEL)
├── logger.ts                  dependency-free JSON logger (stdout/stderr)
├── http/
│   ├── errors.ts              ApiError + stable error codes
│   ├── validate.ts            reusable input validators
│   ├── pagination.ts          limit/offset parsing + response envelope
│   └── types.ts               shared request param/query types
├── middleware/
│   ├── auth.middleware.ts     requireAuth / requireRole
│   ├── rateLimit.middleware.ts global + login limiters
│   ├── error.middleware.ts    the single place errors become responses
│   ├── requestLog.middleware.ts request IDs + one JSON line per request
│   └── pets.middleware.ts     path-param validation
├── cache/
│   ├── client.ts              Redis transport (connect, fail-open, commands)
│   └── cache.ts               key policy + generation-based invalidation
├── messaging/
│   ├── broker.ts              AMQP transport (connect, reconnect, publish)
│   ├── events.ts              audit event envelope + (de)serialisation
│   ├── audit.consumer.ts      queue binding + persist handler
│   └── index.ts               startMessaging() entry point
├── db/                        pool, schema, migrate, seed
├── repositories/              ALL SQL lives here
├── controllers/               HTTP in, JSON out — no SQL (health probes included)
├── routes/                    wiring only (incl. /health/live, /health/ready)
├── auth/                      password hashing + JWT
└── data/pets.ts               domain types only
```

Roughly 1850 lines of TypeScript across 36 source files, plus 55 tests in two Jest projects: 13
unit tests that need no services and 42 integration tests (one is broker-gated) backed by real
Postgres, Redis, and RabbitMQ.

---

## Stage 0 — Tooling

Do not start by writing application code. Start by making the compiler strict and the loop fast.

```bash
mkdir my-api && cd my-api
npm init -y
npm install express cors dotenv
npm install -D typescript @types/node @types/express @types/cors
npm pkg set type=module
```

Use a base config rather than writing one from scratch — you will get sensible strictness and
`nodenext` module resolution for free:

```bash
npm install -D @tsconfig/node20
```

`tsconfig.json`:

```json
{
  "extends": "@tsconfig/node20/tsconfig.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" }
}
```

That base sets `"strict": true`. **Do not turn it off.** Almost every bug described later in this
document would have been caught earlier by the type system if the code had been less loosely typed.

Add a `.gitignore` immediately:

```
node_modules/
dist/
.env
*.log
```

> ⚠️ This repository has **no `.gitignore` yet**. Add one before you ever run `git add .` — your
> `.env` contains a JWT secret.

Scripts in `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "npm run build && nodemon dist/index.js",
    "db:migrate": "npm run build && node dist/db/migrate.js",
    "db:seed": "npm run build && node dist/db/seed.js"
  }
}
```

**Why compile before running?** `nodemon dist/index.js` runs real JavaScript output, so a type
error fails at build time instead of at 2am. Run `npx tsc --noEmit` in a terminal or your editor's
watch mode for instant feedback while editing.

---

## Stage 1 — One endpoint, correct layering

The most common structural mistake in small backends is putting SQL inside route handlers. Resist
it from the very first file, because retrofitting it later is painful.

Three files, one responsibility each:

**`src/routes/`** — wiring only:

```ts
petRouter.get("/", getPets);
petRouter.get("/:id", requireAuth, validateNumericId, getPetById);
```

**`src/controllers/`** — parse HTTP in, serialise HTTP out:

```ts
export const getPetById = async (req, res): Promise<void> => {
    const pet = await findPetById(asInteger(req.params.id, "id", { min: 1 }));
    if (pet === undefined) throw notFound("No pet with that ID");
    res.json(pet);
};
```

**`src/repositories/`** — the only file that knows SQL exists:

```ts
export const findPetById = async (id: number): Promise<Pet | undefined> => {
    const { rows } = await query<PetRow>(
        `SELECT p.*, m.vaccinations FROM pets p ... WHERE p.id = $1`,
        [id],
    );
    return rows[0] === undefined ? undefined : toPet(rows[0]);
};
```

If you ever need to swap Postgres for something else, you touch `db/` and `repositories/`. Routes
and controllers do not change. That is the whole point.

### Express 5 is not Express 4

Express 5 forwards a rejected `async` handler to your error middleware automatically — you do not
need `asyncHandler` wrappers or `try/catch` in every controller. It also uses `path-to-regexp`
with stricter patterns. If an upgrade breaks a route, look at the pattern first.

**Mistake made in this project:** the router was originally mounted at `"/"` instead of `"/pets"`,
so `/pets` matched `/:id` with `id === "pets"`. Symptom was a mysterious `401` on a public route.
Mounting and routing are easy to get subtly wrong — verify with `curl` after every change.

---

## Stage 2 — Database

### Install and configure

```bash
npm install pg
npm install -D @types/pg
```

Store the connection string in `.env` and **never** hardcode it:

```
DATABASE_URL=postgres://pets:pets@localhost:5432/pets
PORT=5000
```

### Validate config once, at boot

Read `process.env` in exactly one file. Reading it scattered across the app means a missing variable
becomes a `undefined` deep inside a query instead of a startup failure you can see.

`src/config/env.ts` throws immediately if a required value is missing or a production secret is too
weak. Fail fast — a server that boots with a bad config is worse than one that refuses to start.

### Connection pooling

A new TCP+TLS+auth handshake per request is expensive. Use `Pool` and reuse connections. Also set
`connectionTimeoutMillis` — without it, a database outage makes HTTP requests hang indefinitely
instead of failing fast (this exact bug was hit while building this project).

```ts
export const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
});
```

### Schema

Define tables in `src/db/schema.ts` as an idempotent string (`CREATE TABLE IF NOT EXISTS`) and run
it from `src/db/migrate.ts`. No migration framework yet — for a single-developer service a checked
SQL string is honest and debuggable. Adopt a migration tool (`dbmate`, `node-pg-migrate`, `kysely`)
once you have real users whose data you cannot truncate.

Two tables, not one, because `medical_records` is a distinct entity:

```sql
CREATE TABLE IF NOT EXISTS pets (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL,
    ...
    age           INTEGER NOT NULL CHECK (age >= 0),
    adopted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS medical_records (
    pet_id       INTEGER PRIMARY KEY REFERENCES pets (id) ON DELETE CASCADE,
    vaccinations TEXT[] NOT NULL DEFAULT '{}',
    weight_kg    NUMERIC(5,2) NOT NULL CHECK (weight_kg > 0),
    microchip_id TEXT UNIQUE
);
```

- `GENERATED ALWAYS AS IDENTITY`, not the legacy `SERIAL`.
- `CHECK` constraints catch bad data at the DB, not just in JavaScript.
- `ON DELETE CASCADE` keeps rows consistent when a pet is removed.
- Index the columns you filter on (`species`, `adopted`).

### Three PostgreSQL gotchas that will bite you

1. **`NUMERIC` comes back as a `string`.** So does `COUNT(*)`. `pg` returns strings to preserve
   precision. Convert explicitly in your row-mapper:
   `weightKg: row.weight_kg === null ? 0 : Number(row.weight_kg)`.
2. **`?limit=abc` is not a param binding issue** — it's a validation issue. Injecting values via
   string concatenation instead of `$1, $2` is how you write an SQL injection hole. Always use
   positional placeholders and a parallel `values` array.
3. **No `ORDER BY` means non-deterministic rows.** Never assume a stable order.

### Seed deliberately

`src/db/seed.ts` truncates before inserting. Without that, re-running duplicated every row — the
table had no unique constraint, so `ON CONFLICT DO NOTHING` never fired. Either truncate first or
give yourself a real uniqueness constraint.

```bash
npm run db:migrate
npm run db:seed
```

---

## Stage 3 — Validation and a single error contract

### The error envelope

Every failure — validation, auth, DB, 404, rate limit — returns the same shape:

```json
{
  "status": 400,
  "code": "VALIDATION_ERROR",
  "message": "limit must be an integer",
  "details": { "field": "limit", "received": "abc" }
}
```

A client can switch on `code`; a human can read `message`. This is built around a small
`ApiError` class with `badRequest` / `unauthorized` / `forbidden` / `notFound` factories.

### One error middleware

`src/middleware/error.middleware.ts` is the *only* place an error becomes a response, and it
resolves in priority order:

1. `ApiError` → its status and code
2. body-parser errors → `400 MALFORMED_JSON`, `413 PAYLOAD_TOO_LARGE`
3. `DatabaseError` → mapped by SQLSTATE (`23505` → 409, `22P02` → 400)
4. anything unknown → `500 INTERNAL_ERROR`, with the real error logged server-side

**Never leak internals.** Step 4 logs the actual `Error` to your console and returns a generic
message. Returning `err.message` to clients can expose table names, connection strings, or paths.

Note that `express.json()` *throws* on malformed JSON. Without a body-parser branch, a bad JSON
body surfaces as a `500` — a genuine bug in this project before that branch existed.

### Validate at the edge

`src/http/validate.ts` provides `asInteger`, `asBoolean`, and `asText`. They throw `ApiError`,
and because controllers are `async`, Express 5 forwards the rejection automatically.

```ts
export const getPets = async (req, res) => {
    const pagination = parsePagination(req.query);        // throws on bad input
    const speciesFilter = asText(species, "species", { maxLength: 64 });
    const adoptedFilter = asBoolean(adopted, "adopted");  // rejects ?adopted=yes
    ...
};
```

**This is a deliberate policy choice you should make consciously.** This project returns `400` for
out-of-range values. An equally valid design *clamps* (`limit=99999` → `100`). Rejecting surfaces
client bugs; clamping is friendlier. What is never right is silently ignoring bad input, which
hides bugs until production.

Query params can be arrays (`?limit=1&limit=2`), so `typeof value !== "string"` must be checked
before treating it as a string. Express 5's default query parser is `node:querystring`.

---

## Stage 4 — Pagination

Pagination is where a naive API quietly falls apart.

### The four rules

1. **`ORDER BY` before `LIMIT`.** Without it, "page 2" is meaningless — the database may return rows
   in any order, so identical requests can differ.
2. **Validate and bound `limit` and `offset`.** `parseInt("abc")` is `NaN`, and `LIMIT NaN` is a
   SQL syntax error that becomes a 500. Clamp or reject; cap the maximum so `?limit=9999999` cannot
   try to dump the table.
3. **Return an envelope.** A bare array cannot express "is there more?" or "how many total?".
4. **Filters must be applied before the page.**

```json
{
  "data": [ ... ],
  "meta": { "total": 6, "limit": 2, "offset": 0, "hasMore": true }
}
```

### Count without a second round trip

A `WITH` CTE computes the filtered total once, then the page is taken from it. Crucially this still
yields a correct `total` when the page is *empty* — `offset=999` returns `data: []` with
`total: 6`, which a naive `COUNT(*) OVER ()` cannot do once `rows` is empty.

```sql
WITH filtered AS (
    SELECT p.*, m.vaccinations, m.weight_kg, m.microchip_id
    FROM pets p
    LEFT JOIN medical_records m ON m.pet_id = p.id
    WHERE ...
)
SELECT filtered.*, (SELECT COUNT(*) FROM filtered) AS total_count
FROM filtered
ORDER BY filtered.id
LIMIT $n OFFSET $m
```

`filtered.id` is unambiguous because `medical_records` uses `pet_id`, not `id`.

### The `LIMIT`-after-`JOIN` trap

`LIMIT` applies to *joined* rows. This project is safe because `medical_records` is strictly `1:1`.
If you ever add a second one-to-many relation to the same query, pagination silently breaks — rows
duplicated by the join get counted as separate pets. The robust pattern is exactly the one above:
**paginate in a CTE, then join to it.**

### `OFFSET` drifts

Between fetching page 1 and page 2, if a row is inserted or deleted, every row shifts — clients see
duplicates and omissions. This is inherent to `OFFSET`, not a bug. Keyset (cursor) pagination with
`WHERE id < $lastSeen ORDER BY id DESC` avoids it entirely and stays index-friendly, at the cost of
not supporting "jump to page 7". Adopt keyset when your tables get large or your data changes
rapidly; `OFFSET` is fine while the data fits comfortably in memory.

---

## Stage 5 — Authentication

### Passwords

```bash
npm install bcryptjs
npm install -D @types/jsonwebtoken  # jsonwebtoken ships none
npm install jsonwebtoken
```

Never store plaintext. bcrypt is salted and cost-factored:

```ts
export const hashPassword = async (plain: string): Promise<string> =>
    bcrypt.hash(plain, config.bcryptRounds);
```

`$2b$10$...` — the cost is the exponent. Raise `BCRYPT_ROUNDS` on faster hardware. Hashing runs on
a worker thread in `bcryptjs`, but in a high-traffic Node service you must still budget for its CPU
cost — it is deliberately slow.

### Issue and verify a JWT

```ts
jwt.sign({ email, role }, config.jwtSecret, {
    subject: String(user.id),
    algorithm: "HS256",
    expiresIn: config.jwtExpiresIn,
    issuer: "ex_ty",
    audience: "ex_ty_api",
});
```

Then **always pin the algorithm on verify** — this is the defence against `alg`-confusion and the
`alg: none` forgery attack:

```ts
jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"], issuer, audience });
```

The verification test was run against this app: a token whose payload was rewritten from
`sub:1` to `sub:2` while keeping the original signature, and a hand-forged `alg:"none"` token, were
both correctly rejected with `401`.

Put only claims you need (`sub`, `email`, `role`). The payload is base64, **not** encrypted —
anyone can read it. Never place secrets there.

### Two attacks you must design out

**User enumeration.** If "unknown email" and "wrong password" produce different responses, an
attacker can harvest valid emails. Both must return the identical `401 Invalid email or password`.

```ts
const user = await findUserByEmail(email);
const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
if (user === undefined || !passwordMatches) throw unauthorized("Invalid email or password");
```

The `DUMMY_HASH` branch matters: without it, a missing user returns *faster* than a real one,
leaking existence through timing. For production, prefer Argon2id or password-lookup against a
dedicated table, both of which make this cleaner.

**Information leakage from token errors.** Missing header, malformed header, expired token and bad
signature all get generic messages. Distinguishing "expired" from "invalid signature" tells an
attacker which they are close to.

### Type the user onto the request

Express has no `req.user` by default. Augment it so you get autocompletion *and* a type error if
you forget to check for it:

```ts
declare global {
    namespace Express {
        interface Request {
            user?: { id: number, email: string, role: UserRole };
        }
    }
}
```

`requireAuth` populates `req.user`; `requireRole("admin")` returns 403 for the wrong role. Because
`user` is optional, TypeScript forces you to handle `undefined` — that is the entire reason for the
augmentation.

---

## Stage 6 — Rate limiting

```bash
npm install express-rate-limit
```

Two limiters with different budgets:

| | window | limit | why |
| --- | --- | --- | --- |
| global | 60s | 100 | broad protection for the whole API |
| login | 15m | 10 | brute-force protection, stricter, ignores successes |

```ts
app.use(globalLimiter);                              // everything
authRouter.post("/login", loginLimiter, login);      // tighter on the expensive route
```

Returns `429` with the project's standard error envelope, plus RFC draft-7 headers:

```
RateLimit-Policy: 100;w=60
RateLimit: limit=100, remaining=83, reset=39
```

`skipSuccessfulRequests: true` on the login limiter means a user mistyping their password 10 times
hits the wall, while 100 successful API calls do not.

### The `trust proxy` trap

Behind a load balancer or reverse proxy, the TCP connection always originates from the proxy. The
limiter's default key is the client IP, so **every user would share one bucket** and your real
users would be locked out after a few hundred requests. You must tell Express how many proxy hops
to trust:

```ts
app.set("trust proxy", config.trustProxy);
```

This is the single most common production rate-limiting failure. Configure it from the environment,
not inline — the correct value is `1` behind one proxy and `0` locally.

### What this limiter is not

The default `MemoryStore` is per-process. It resets on restart and does **not** share counts
between instances — with three replicas each allowing 100, you effectively allow 300. For anything
multi-process, use a shared store (`rate-limit-redis`). It is also keyed on IP alone, so it will
not stop a distributed attack across many IPs — for login specifically, combine with account
lockout, CAPTCHA, or anomaly detection.

---

## Stage 7 — Verifying as you go

Every stage in this project was checked with `curl`, not just with a browser. Reproducible smoke
test against a running server:

```bash
# login
TOKEN=$(curl -sS -X POST localhost:5000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-password-123"}' \
  | node -p "JSON.parse(require('fs').readFileSync(0)).accessToken")

# protected resource
curl -sS -H "Authorization: Bearer $TOKEN" localhost:5000/pets/1

# public list, paginated + filtered
curl -sS 'localhost:5000/pets?limit=2&offset=0&species=dog'

# validation rejects bad input
curl -sS 'localhost:5000/pets?limit=abc'
# 400 {"status":400,"code":"VALIDATION_ERROR","message":"limit must be an integer",
#      "details":{"field":"limit","received":"abc"}}

# unauthenticated
curl -sS localhost:5000/pets/1
# 401 {"status":401,"code":"UNAUTHORIZED","message":"Missing or malformed Authorization header"}
```

Plus `npx tsc --noEmit` on every change.

---

## Stage 8 — Caching reads with Redis

The fastest query is the one you do not run. Both read endpoints are cache-aside:

1. **Read through** — check Redis first; on a hit, return without touching Postgres.
2. **Miss path** — run the SQL, write the result into Redis with a TTL, return.
3. **`X-Cache` header** — `HIT`, `MISS`, or `SKIP` (`SKIP` means caching was disabled or Redis was
   down, so you can tell "not cached" from "cache missed and will be written").
4. **Invalidate on writes** — there are no write endpoints yet, but `npm run db:seed` is a write, so
   seeding bumps a generation counter that expires every cached key in one `INCR`.

### Why a generation counter instead of `FLUSHALL` or `KEYS`

If `pets` were written to rarely, `FLUSHALL` on every write would be fine. But:

- `KEYS pets:*` (or `SCAN`) has to enumerate every key *on the same Redis instance* to delete them,
  and the list keys are a **one-way hash** of their sorted query params — you cannot reliably
  reconstruct them from a request.
- `FLUSHALL` nukes unrelated keys and is a blunt instrument you will misuse at 2am.

Instead every key embeds a counter — `pets:0:list:limit=2&offset=0`,
`pets:0:id:2` — and invalidation is just `INCR pets:generation`. Old keys stay in Redis but are
never read again; their TTL cleans them up. That is **O(1) invalidation with zero enumeration**,
regardless of how many keys exist.

### The key policy

```ts
pets:{generation}:list:{sorted,url-encoded params}   // e.g. pets:0:list:adopted=true&limit=15&offset=0&species=dog
pets:{generation}:id:{id}                            // e.g. pets:0:id:2
```

- Params are **sorted** so `?species=dog&adopted=true` and `?limit=15&offset=0` always hash to the
  same stable key.
- `species` is lower-cased *before* hashing, because the SQL already lower-cases it — otherwise
  `species=dog` and `species=Dog` cache the same result under two keys.
- **List keys and id keys share the generation**, so one `INCR` invalidates both — critical after a
  re-seed, because `RESTART IDENTITY` reuses ids and a stale `pets:0:id:1` could point at a
  *different* pet.

### The transport must never throw into the request path

A cache that takes the app down is worse than no cache. The client is **fail-open**:

- `createClient` connects lazily; `connect()` failures are caught and logged **once**.
- Every command routes through `connected()` — if the client is not ready it returns `undefined`,
  and the caller falls through to Postgres.
- Redis errors (`ECONNREFUSED`, timeout, `OOM`) are caught in the transport; the repository only
  ever sees a cache miss (reported as `SKIP`).

Verify the fallback by stopping Redis while the server runs — `/pets` still returns 200s, it just
stops setting `X-Cache: HIT`.

### TTLs are your consistency budget

| Key | TTL |
| --- | --- |
| `pets:...:list:*` | 30s |
| `pets:...:id:*` | 60s |

Short TTLs are a deliberate trade: pets change slowly, so 60s is safe, but a re-seed or future write
must take the generation path to stay correct. Anything cached for longer than a few minutes needs a
real invalidation plan, not a longer TTL.

### What we deliberately did not cache

- **Identity and auth** (`/auth/me`, login). Credentials and permissions must be read fresh every
  time; caching them is a security bug waiting to happen.
- **Negative results.** `GET /pets/999` (a 404) is not cached, so it is a miss every time. That is
  the conservative default — negative caching (a tombstone with a short TTL) is a real optimization,
  but a wrong TTL turns deleted entities into permanent 404s.
- **Write-side values.** There is no `POST`/`PUT` yet, so invalidating is one `INCR` in `seed.ts`.
  When you add write endpoints, every successful write bumps the generation — which is exactly why
  the counter lives outside the repositories, ready for them.

### The JSON round-trip gotcha

Redis stores strings. You `JSON.stringify` on write and `JSON.parse` on read, so `intakeDate`
(a `Date` in your domain type) comes back as an **ISO string**. The repository's `revivePet`
rebuilds `Date` fields after a cache hit — otherwise `Date` instances silently become strings and
any later `.toISOString()` call in controllers breaks with a type error your compiler never saw.

### Verification

```bash
# install Redis, then:
sudo apt-get install -y redis-server && sudo service redis-server start

redis-cli FLUSHALL
curl -sS -o /dev/null -D - 'localhost:5000/pets?limit=2' | grep -i x-cache   # MISS
curl -sS -o /dev/null -D - 'localhost:5000/pets?limit=2' | grep -i x-cache   # HIT

npm run db:seed            # bumps the generation counter
redis-cli get pets:generation      # 0 → 1
curl -sS -o /dev/null -D - 'localhost:5000/pets?limit=2' | grep -i x-cache   # MISS again

# fallback: while Redis is down
sudo service redis-server stop
curl -sS -o /dev/null -D - 'localhost:5000/pets?limit=2' | grep -i x-cache   # SKIP, still 200
sudo service redis-server start
```

---

## Stage 9 — Automated tests with Jest and Supertest

The manual `curl` door is good in the first stages, but it stops scaling. The locked-in guarantees
are: the error envelope, validation, auth, and cache behavior.

### The tooling decision: `@swc/jest`, not `ts-jest`

This project runs **TypeScript 7 (the native Go port), which exposes no JavaScript compiler API** —
`ts.transpileModule`, `ts.createProgram` are gone, and `ts-jest` requires `typescript >=4.3 <7`.
SWC compiles independently of TypeScript's API, so `@swc/jest` is the drop-in:

```bash
npm i -D jest @types/jest @swc/jest @swc/core supertest @types/supertest
```

`jest.config.mjs`:

```js
export default {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  transform: { "^.+\\.ts$": ["@swc/jest", { module: { type: "commonjs" } }] },
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  setupFiles: ["<rootDir>/tests/setup/env.ts"],
  globalSetup: "<rootDir>/tests/setup/global-setup.ts",
  maxWorkers: 1,
};
```

Two choices are load-bearing:

- **`moduleNameMapper` strips `.js`.** The source imports `./config/env.js` (required for Node ESM).
  In tests, `.ts` files are transformed to CommonJS, so `require("./config/env.js")` must become a
  `.ts` lookup. The `^(\\.{1,2}/.*)\\.js$` → `$1` mapping is the standard recipe.
- **ESM throughout.** Jest transforms the `.ts` files to CJS, so no `--experimental-vm-modules` is
  needed. Keep `import.meta`/dynamic `import` out of src and this stays true.

### Split the app from the listener (or SuperTest binds a port)

`app.listen()` ran at import time, so `import { app }` inside a test would grab port 5000.
Split:

- `src/app.ts` — **builds and exports `app`**; also starts the cache.
- `src/index.ts` — imports `app`, calls `app.listen`.

Supertest then creates its own ephemeral listener per test: `request(app)`.

### Config/env for a hermetic run

`tests/setup/env.ts` runs before every suite (`setupFiles`) and pinpoints the app at a separate
world before `config` ever evaluates:

- `DATABASE_URL` → `pets_test` (dev data untouched)
- `REDIS_URL` → `redis://127.0.0.1:6379/15` (a dedicated Redis DB index; `global-setup` calls
  `FLUSHDB` on it)
- `BCRYPT_ROUNDS=4` (tests would otherwise pay bcrypt-10 per login)
- `RATE_LIMIT_MAX=10000` (keep the global limiter out of the way; the login limiter stays at 10 so
  the rate-limit test is real)

Because `.env` is loaded via `dotenv/config` *inside* `app.ts`, and `dotenv` never overrides an
existing `process.env` key, the values above win.

### The global-setup trap

`globalSetup` is loaded with **plain Node `require`**: it is *transformed* by SWC but **not**
resolved through Jest's `moduleNameMapper`. An import like `../../src/db/schema.js` can never
resolve to `.ts` there. Keep the setup file self-contained — own its own copy of the schema and
fixtures, create the test database, `CREATE`/`TRUNCATE`/seed:

```
tests/setup/global-setup.ts        integration project only: creates pets_test, schema, seeds, FLUSHDB
tests/setup/env.ts                 per-process env before the app loads
tests/error-handler.unit.test.ts   errorHandler mapping (no services)
tests/audit-events.unit.test.ts    audit envelope build/parse (no services)
tests/pets.integration.test.ts     pagination, filters, validation, cache HIT/MISS/invalidation
tests/auth.integration.test.ts     login, anti-enumeration, expired/forged tokens, 429 rate limit
tests/health.integration.test.ts   liveness/readiness, limiter bypass
tests/error.integration.test.ts    error envelope over HTTP
tests/messaging.integration.test.ts fail-open + publish -> consume -> persist
```

`globalSetup` is attached only to the `integration` Jest project, so `npm run test:unit` needs no
database (see Stage 14).

For the `pets` role to run `CREATE DATABASE pets_test` it needs `CREATEDB`:
`sudo -u postgres psql -c "ALTER ROLE pets CREATEDB;"`.

### Teardown, or Jest never exits

`app.ts` opens a Redis connection and the repositories use a `pg` pool. Without closing them,
Jest finishes 1s+ later with an open-handle warning. Each suite ends with:

```ts
afterAll(async () => { await stopBroker(); await stopCache(); await pool.end(); });
```

### Asserting the cache honestly

`isCacheActive()` (Redis up + enabled) is captured in `beforeAll` after `await startCache()` —
which must return the *actual* connect promise, not a resolved one, or you race the connection the
app itself already started. The cache test then asserts `MISS → HIT` when active, else `SKIP`;
either way the assertions are deterministic and the suite does not hard-depend on Redis.

```bash
npm test          # 55 tests: 8 suites across unit + integration projects (1 broker-gated)
npm run test:watch
```

---

## Stage 10 — Messaging with RabbitMQ

The API must record every login attempt (success *and* failure) for auditing. Writing directly to
Postgres from the login handler couples latency and availability to a second table. Instead the
request publishes an event and returns; a background consumer owns persistence.

### Topology

- Exchange `ex_ty.events` — **topic**, durable.
- Queue `ex_ty.audit` — durable, bound with `auth.#`.
- Routing keys `auth.login.succeeded` / `auth.login.failed`, published as **persistent** messages
  with a `messageId` set to the event's UUID.

One exchange, one queue, one consumer. That is deliberately the smallest topology that still teaches
the mechanics (routing, durability, ack/nack) without pretending to be a full event platform.

### The event envelope

Define the wire format once and validate on the way in — a consumer must never trust the broker:

```ts
type AuditEvent = {
  eventId: string;        // randomUUID()
  type: "auth.login.succeeded" | "auth.login.failed";
  occurredAt: string;     // ISO-8601
  payload: { email: string; userId?: number; role?: string; reason?: string };
};
```

`buildAuditEvent()` stamps `eventId`/`occurredAt`; `parseAuditEvent()` returns `undefined` for
anything malformed, so the consumer can ack-and-drop poison messages instead of crashing.

### Fail-open, exactly like Redis

The transport (`messaging/broker.ts`) mirrors `cache/client.ts`:

- `publishEvent()` returns `false` when the channel is not ready — it never throws into the request.
- The controller calls `void publishEvent(...)`, so login succeeds even with RabbitMQ down.
- Connection errors are logged **once**; a single reconnect timer (`.unref()`) retries with capped
  backoff and never keeps the process alive.
- Consumers register through `onChannelReady(setup)`. Setups run on every (re)connect, which is what
  re-establishes `assertQueue`/`bindQueue`/`consume` after a disconnect.

### Consume, persist, acknowledge

The consumer inserts with `ON CONFLICT (event_id) DO NOTHING` (idempotent redelivery), then `ack`s.
A malformed message is acked and dropped; a DB failure is `nack(msg, false, false)` so the message is
discarded rather than hot-looping. No DLQ yet — see the gap list.

### Verification

```bash
sudo apt-get install -y rabbitmq-server && sudo service rabbitmq-server start

# normal run: events are consumed and stored
npm start
curl -s -o /dev/null -X POST localhost:5000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"user-password-123"}'
psql "$DATABASE_URL" -c "SELECT type, payload->>'email' AS email FROM audit_events;"

# fail-open: stop the broker, log in again — still 200, one warning in the log
sudo service rabbitmq-server stop
```

The suite defaults to `BROKER_ENABLED=false` so it is hermetic. The publish→consume→persist test is
gated and only asserts when a broker is actually reachable:

```bash
BROKER_ENABLED=true npm test
```

---

## Stage 11 — Health checks and graceful shutdown

A service that cannot be probed and cannot be stopped cleanly is not deployable, no matter how good
the request handling is.

### Liveness vs. readiness

They answer different questions and must not share a handler:

- `GET /health/live` — "is the process alive?" It returns `200` immediately and touches **nothing**.
  If this fails, the orchestrator should restart the container.
- `GET /health/ready` — "can this instance serve traffic?" It probes Postgres with a bounded
  `SELECT 1` (2s race using `Promise.race`, not an unbounded wait) and reports the state of every
  dependency:

```json
{ "status": "ready", "uptime": 2.23,
  "checks": { "database": "up", "cache": "up", "broker": "down" } }
```

Readiness is `200` when the **required** dependency (Postgres) is up and `503` otherwise. Cache and
broker are reported as `up` / `down` / `disabled` but **do not fail readiness** — they are fail-open
by design, so their downtime must not pull every instance out of the load balancer.

Mount both **before** the global rate limiter: probes are high-frequency and must never receive a
`429` just because the service is popular.

### Shutdown: stop accepting, then drain, then close

`index.ts` owns the listener, so it owns the lifecycle. On `SIGTERM`/`SIGINT`:

1. `server.close()` stops accepting new connections (and `closeIdleConnections()` drops keep-alive
   sockets that would otherwise delay the close).
2. Wait for in-flight requests to finish.
3. Close the broker, then Redis, then `pool.end()` — in that order, so handlers cannot publish or
   query after their transport is gone.
4. `process.exit(0)`.

A `10s` watchdog (`unref`'d) forces `exit(1)` if a request refuses to drain, so a deploy can never
hang forever. Repeated signals are ignored via a `shuttingDown` flag.

```bash
node dist/index.js & SRV=$!
curl -s localhost:5000/health/ready
kill -TERM "$SRV"; wait "$SRV"; echo "exit=$?"   # exit=0, "[shutdown] complete"
```

Signal the **Node PID**, not a wrapper: `cd dir && node app &` backgrounds the whole list, so `$!`
is the shell, and killing it yields `exit=143` with no drain logs.

---

## Stage 12 — Containerizing with Docker

A two-stage build keeps the toolchain out of the runtime image: stage one installs dev dependencies
(TypeScript, SWC, Jest), compiles `src → dist`, then prunes; stage two copies only the compiled
output, production `node_modules`, and `package.json` (needed for `"type": "module"`).

### The three things that must line up

1. **`WORKDIR`.** Use an absolute path (`/app`) in *both* stages. `WORKDIR .` resolves to `/`, so a
   later `COPY --from=build /app/dist` silently points at nothing and the build fails.
2. **Port.** `EXPOSE`, `HEALTHCHECK`, and the app must agree. The app defaults to `PORT=5000`; if
   you expose `8080`, you must also `ENV PORT=8080`.
3. **Health path.** The probe must hit a route that exists. `/healthz` is a 404; the real liveness
   endpoint is `/health/live`. Use liveness (not readiness) for Docker's `HEALTHCHECK` so a
   Postgres blip does not mark the container unhealthy.

### Reproducible installs

`COPY package.json package-lock.json ./` then `RUN npm ci`. `npm install` re-resolves versions and
can drift from the lock. Do not `npm install` again after `npm ci`.

### Non-root and least privilege

```dockerfile
RUN adduser -D -u 10001 app
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./
USER app
```

Create the user *before* the copies so `--chown` resolves, and switch to `USER app` *after* them.
`.env` is in `.dockerignore` — secrets must never be baked into a layer; configuration arrives at
runtime via environment variables.

### Running it

```bash
docker build -t ex_ty .

docker run --rm -p 5000:5000 \
  --network host \
  -e DATABASE_URL=postgres://pets:pets@localhost:5432/pets \
  -e JWT_SECRET=change-me-to-at-least-32-characters \
  -e REDIS_URL=redis://127.0.0.1:6379 \
  -e RABBITMQ_URL=amqp://localhost:5672 \
  ex_ty

curl -s localhost:5000/health/live      # {"status":"ok",...}
curl -s localhost:5000/health/ready     # {"status":"ready","checks":{...}}
```

`NODE_ENV=production` is baked into the image, so `JWT_SECRET` **must** be ≥32 characters or boot
fails fast. The database schema is not created on startup: run migrations as a one-off, using the
compiled entry point (the runtime image has no `tsc`):

```bash
docker run --rm --network host \
  -e DATABASE_URL=postgres://pets:pets@localhost:5432/pets \
  ex_ty node dist/db/migrate.js
```

Verified in this repo: build succeeds on `node:22-alpine` (the TypeScript 7 compiler is a statically
linked Go binary, so musl is fine), the container runs as `app`, Docker reports `healthy`, a login
writes an `audit_events` row, and `docker stop` drains cleanly with `ExitCode=0`.

---

## Stage 13 — Compose and a reverse proxy

The image is one process; a deployable system is several. `compose.yaml` wires two app replicas,
Postgres, Redis, RabbitMQ, and an nginx proxy. The whole stack starts with one command after the
env file is in place:

```bash
cp ex_ty.env.example ex_ty.env
docker compose -f compose.yaml up -d --wait
```

`app` and `migrate` share a `build:` block via a YAML anchor, alongside `image: ex_ty:local`. Plain
`up` builds the image when it is missing and reuses it otherwise; use `up --build` after changing
source code. The first run also pulls the Postgres, Redis, RabbitMQ, and nginx base images. Validate
the file before running anything:

```bash
docker compose -f compose.yaml config --quiet   # catches typos/unknown keys
```

Without `ex_ty.env`, Compose aborts with "env file not found" — that is the only manual prerequisite.
The image is tagged `ex_ty:local`; before `build:` was added, a fresh clone failed because Compose
tried to pull that non-existent tag from a registry.

Topology:

```
client → nginx :8080 (host) → app:5000 (2 replicas, internal only)
                                 ├── postgres:5432
                                 ├── redis:6379
                                 └── rabbit_mq:5672
```

### The port you curl is the proxy, not the app

`EXPOSE 5000` in the Dockerfile only documents the container port; it does **not** publish it. In
Compose, **only `proxy` publishes a host port** (`8080:80`). The app replicas have no `ports:` entry,
so `curl localhost:5000` fails with `Connection refused` while `curl localhost:8080/health/live`
returns `200`. That is by design: traffic enters through nginx.

You cannot publish `5000:5000` on `app` while running two replicas — the same host port cannot be
bound twice. Either keep using `:8080`, drop to one replica, or reach a specific replica with
`docker compose exec --index 1 app sh`.

### Names must line up

`nginx.conf` proxies to `app:5000`, so the Compose service must be named `app`, and the proxy's
`depends_on` must reference `app`. A service named `api` with `depends_on: app` fails validation
because `app` does not exist. Likewise `RABBITMQ_URL` must use the service name (`rabbit_mq`) or a
network alias, not `localhost`.

### Compose keys that are easy to get wrong

- Resource limits live under `deploy.resources.limits`, not `deploy.limits` (the latter is rejected
  by `docker compose config`).
- Top-level `volumes:` must be at column 0. Indenting it under `services:` silently defines a
  service named `volumes`.
- Redis 7 writes to `/data` (AOF under `/data/appendonlydir`); mounting `/var/lib/data` persists
  nothing.
- Postgres needs `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` and a named volume, or its
  state vanishes on recreate — and the app's `DATABASE_URL` must match those credentials.

### Env files: example in git, real file ignored

`.env` is for running locally (`localhost` hostnames). The containers need a separate file with
service hostnames, so `ex_ty.env` sets `DATABASE_URL=…@postgres:5432/…`, `REDIS_URL=redis://redis:6379`,
and `RABBITMQ_URL=amqp://admin:secretpassword@rabbit_mq:5672`. It is git-ignored and excluded from
the build context — never bake secrets into an image. `ex_ty.env.example` holds the same dev-only
values and **is** committed, so a fresh clone becomes runnable after `cp ex_ty.env.example ex_ty.env`;
replace its secrets before exposing the stack to anything real.

### Startup ordering, migrations, and seeding

Each long-running service has a `healthcheck`, and `app` waits on `depends_on` conditions
(`service_healthy` for Postgres/Redis/RabbitMQ, `service_completed_successfully` for the one-shot
`migrate` service). The migration uses the compiled entry point because the runtime image has no
`tsc`:

```yaml
x-app: &app-base
  build: { context: ., dockerfile: Dockerfile }
  image: ex_ty:local

migrate:
  <<: *app-base
  command: ["node", "dist/db/migrate.js"]
  restart: "no"
```

Migrations create the schema; they do **not** insert fixtures. A fresh volume therefore has zero
users and login returns `401`. Seed once when you want the demo data:

```bash
docker compose -f compose.yaml run --rm app node dist/db/seed.js
```

### Reading the logs

At startup you may see:

```
[cache] unavailable, falling back to database: Error: Socket closed unexpectedly
[broker] unavailable, events will be dropped: Error: connect ECONNREFUSED …:5672
```

Both are expected when the app wins the race against its dependencies. The transports are fail-open
and reconnect (warn-once), so the server serves traffic and `/health/ready` eventually reports
`cache`/`broker: up`. Check readiness rather than assuming the first log line is fatal.

### The load-balancer caveat

nginx resolves `server app:5000;` **once at startup**. With two replicas both are picked up on first
boot, but if a replica is recreated nginx keeps the stale IP. For dynamic membership, add Docker's
resolver and a variable target:

```nginx
resolver 127.0.0.11 valid=10s;
set $api http://app:5000;
proxy_pass $api;
```

### Compose cheat sheet

```bash
docker compose -f compose.yaml up -d --wait       # build if missing, wait for health
docker compose -f compose.yaml up -d --build      # rebuild after source changes
docker compose -f compose.yaml ps                 # service/replica status
docker compose -f compose.yaml ps -a              # include the exited migrate job
docker compose -f compose.yaml logs -f app proxy  # follow logs
docker compose -f compose.yaml exec --index 1 app sh
docker compose -f compose.yaml down -v            # stop and delete volumes
```

---

## Stage 14 — CI pipeline

`.github/workflows/ci.yml` runs on every push and pull request. It is one job with ordered steps, so
a failure anywhere stops the pipeline and the check turns red:

```
npm ci → lint → typecheck → unit tests → tests + coverage → build
```

Jest exits non-zero on any failed assertion, and GitHub Actions stops the job at the first failing
step. There is no `--passWithNoTests` or `|| true` anywhere to mask a broken suite.

### Service containers

The job declares Postgres, Redis, and RabbitMQ as `services`, each with a health check, and exports
`DATABASE_URL`, `REDIS_URL`, and `RABBITMQ_URL` pointing at `localhost`. The integration suite's
`globalSetup` connects to the base database, creates `pets_test`, seeds it, and flushes Redis DB 15 —
exactly as it does locally. `BROKER_ENABLED=true` in CI means the broker-gated publish → consume →
persist test runs instead of skipping.

### Unit vs integration split

`jest.config.mjs` defines two projects:

| Project | File pattern | Needs services | Setup |
| --- | --- | --- | --- |
| `unit` | `tests/**/*.unit.test.ts` | no | `tests/setup/env.ts` only |
| `integration` | `tests/**/*.integration.test.ts` | Postgres, Redis (RabbitMQ optional) | env + `global-setup.ts` |

The pure assertions that used to live inside mixed files were extracted into
`error-handler.unit.test.ts` and `audit-events.unit.test.ts`; the supertest suites were renamed
`*.integration.test.ts`. The scripts select a project without loading the other's setup:

```bash
npm run test:unit          # fast, no DB
npm run test:integration   # requires Postgres + Redis
```

`npm test` still runs both projects.

### Coverage

`jest.coverage.config.mjs` is a single Jest project that matches every `*.test.ts`. It exists
because the multi-project runner writes one report per project into the same directory; one project
means one merged report and one threshold check.

```bash
BROKER_ENABLED=true npm run test:coverage
```

- Includes `src/**/*.ts`; excludes declaration files, the type-only `src/data/**`, and entry/CLI
  files that tests never execute: `src/index.ts`, `src/db/migrate.ts`, `src/db/seed.ts`.
- Thresholds sit a couple of points below the measured broker-on baseline: statements/lines 88%,
  functions 86%, branches 73%. Measure first, then change a number; ratchet upward as tests are
  added.
- CI runs this after the fast unit gate, uploads `coverage/` as an artifact, and fails the job on a
  threshold breach.
- `README.md` documents the same quick start, env table, API, and scripts for newcomers.

### Lint without type-aware tooling

TypeScript 7 here is the native Go compiler. `typescript-eslint` 8.x declares a peer range of
`typescript >=4.8.4 <6.1.0`, so installing it against TS 7 fails. The pipeline uses **oxlint**, a
Rust linter that parses TypeScript directly and needs no type program:

```bash
npm run lint       # oxlint src tests
npm run typecheck  # tsc --noEmit
```

Lint and type check are separate stages on purpose: lint is rule-based and fast, while `tsc` is the
authority on types.

### Reproduce CI locally

```bash
npm run lint && npm run typecheck && npm run test:unit
BROKER_ENABLED=true npm run test:coverage   # all 55 tests + thresholds
npm run build
```

### Closing channels safely

Draining the broker while a consumer is mid-message makes `ack`/`nack` throw on a closed channel.
That surfaces as an unhandled rejection after the assertions pass, which still fails Jest. The
consumer wraps both replies in `settle()`, so a closed channel is ignored instead of tearing down
the suite.

---

## Stage 15 — Container logging and request IDs

Containers log to stdout/stderr and the runtime collects it. The app writes one JSON object per line
through `src/logger.ts`:

```json
{"level":"info","time":"2026-11-12T12:11:49.213Z","msg":"request completed","requestId":"2c55ee84…","method":"GET","path":"/pets","status":200,"durationMs":12.926}
```

- `LOG_LEVEL` is `error | warn | info | debug | silent`. Production defaults to `info`, local dev to
  `debug`, and tests to `silent` (`tests/setup/env.ts`).
- `warn`/`error` go to stderr, `info`/`debug` to stdout.
- Errors are normalized to `{ name, message, stack }`; `JSON.stringify(new Error("x"))` otherwise
  produces `{}`.
- `formatLogEntry()` is pure, so it is unit-tested without capturing process streams.

### Request IDs and access logs

`requestLogger` runs before routing. It reuses an incoming `X-Request-ID` or generates a UUID,
stores it in `res.locals.requestId`, and echoes it on the response. `errorHandler` includes the same
ID, so a request line and an error line can be joined. Liveness probes (`/health/live`) are excluded
so the Docker health check does not flood the log every 20 seconds.

nginx is the entry point for proxied traffic, so it owns the ID:

```nginx
log_format ex_ty '… request_id=$request_id request_time=$request_time upstream_time=$upstream_response_time';
proxy_set_header X-Request-ID $request_id;
```

`$request_id` is generated by nginx and passed upstream; the app logs the same value. The official
nginx image symlinks `access.log`/`error.log` to stdout/stderr, so both land in `docker compose logs`.
One request now yields a correlated nginx access line, an app JSON line, and any error line.

### Log rotation (compose)

Docker's default `json-file` driver has **no size limit**. Compose applies a shared anchor to every
service:

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
    compress: "true"
```

Inspect the applied config and follow the stream:

```bash
docker inspect ex_ty-app-1 --format '{{json .HostConfig.LogConfig}}'
docker compose -f compose.yaml logs -f app proxy
curl -s -D - -o /dev/null localhost:8080/health/live   # note X-Request-ID
```

### Going further: pino (option B)

The built-in logger is enough for this repo; pino adds performance, serializers, redaction, and an
ecosystem. To migrate:

1. Install `pino` and `pino-http` (`pino-pretty` as a dev dependency for local pipes).
2. Replace the internals of `src/logger.ts` with a pino instance, keeping the exported `logger`
   shape so call sites do not change:
   ```ts
   import pino from "pino";
   import { config } from "./config/env.js";

   export const logger = pino({
       level: config.logLevel,
       base: { service: "ex_ty" },
       timestamp: pino.stdTimeFunctions.isoTime,
       formatters: { level: (label) => ({ level: label }) },
       redact: {
           paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash"],
           censor: "[redacted]",
       },
   });
   ```
   `formatLogEntry` disappears; delete its unit test or point it at a pino destination stream.
3. Replace `requestLogger` with `pino-http`:
   ```ts
   import { randomUUID } from "node:crypto";
   import { pinoHttp } from "pino-http";
   import { logger } from "../logger.js";

   export const requestLogger = pinoHttp({
       logger,
       genReqId: (req, res) => {
           const id = req.headers["x-request-id"] ?? randomUUID();
           res.setHeader("X-Request-ID", id);
           return id;
       },
       customLogLevel: (_req, res, err) =>
           err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
       autoLogging: { ignore: (req) => req.url === "/health/live" },
       serializers: {
           req: (req) => ({ method: req.method, url: req.url, id: req.id }),
           res: (res) => ({ statusCode: res.statusCode }),
       },
   });
   ```
   Keep `res.locals.requestId = req.id` if `errorHandler` should keep reading it, or type-augment
   Express and read `req.id`.
4. Keep nginx's `X-Request-ID` and the compose rotation unchanged: pino reads the ID through
   `genReqId`, so nginx and app lines still correlate.
5. Verify redaction by sending `Authorization: Bearer …` and a login body containing `password`;
   neither value should appear in `docker compose logs app`.
6. Use `pino-pretty` only for local pipes (`docker compose logs -f app | npx pino-pretty`), not as a
   production transport unless you accept the extra dependency in the image.

Trade-off: pino adds two runtime dependencies and its config surface; the dependency-free logger
already provides JSON, levels, and correlation IDs with nothing extra to audit.

---

Read these and you will avoid a day of debugging:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every request hangs, 0 bytes, forever | `app.use(cors)` — the factory itself, never calls `next()` | `app.use(cors())` |
| `401` on a public route | Router mounted at `"/"` instead of `"/pets"` | fix the mount path |
| `GET /pets/5` always `400` | Regex `/^\d+s/` (literal `s`) instead of `/^\d+$/` | `$` anchor |
| `TS2339: Property 'offset' does not exist` | Query type never declared `limit`/`offset` | declare them |
| `.env` ignored | `dotenv` installed but never imported | `import "dotenv/config"` |
| Requests 500 on bad JSON | body-parser `Error` unhandled | branch on `err.type` |
| DB query never settles | `Pool` without `connectionTimeoutMillis` | set a timeout |
| `weightKg` is a string | Postgres `NUMERIC` → JS `string` | `Number()` in the mapper |
| Re-seeding duplicates rows | No unique constraint, so `ON CONFLICT` never fires | `TRUNCATE` first |
| Stale `/pets/1` after re-seed | `pets:id` keys not generation-scoped; `RESTART IDENTITY` reuses ids | namespace list *and* id keys by generation |
| `intakeDate` became a string | `JSON.stringify`→`JSON.parse` round-trip loses `Date` | `revivePet()` rebuilds dates on cache hit |
| Redis down ⇒ app errors | transport threw or awaited a reconnect | fail-open `connected()` guard in the transport |
| Repeated 5xx when Redis hiccups | every request logged the same error | warn **once** per outage, clear on `ready` |
| DB down returns `500 INTERNAL_ERROR` | `pg` connection errors are plain `Error`s (`code: ECONNREFUSED`), not `DatabaseError` — the SQLSTATE map never saw them | detect node-level socket codes + pg's timeout message, map to `503 DATABASE_ERROR` |
| `Cannot find module '../../src/db/schema.js'` | `globalSetup` is Node-`require`d without `moduleNameMapper`, so `.js` never maps to `.ts` | keep global setup self-contained (own schema/fixtures), no src imports |
| Tests finish, process hangs | the app's Redis client + `pg` pool keep sockets open | `afterAll` → `stopCache()` + `pool.end()` |
| Cache test flakes: expected `SKIP`, got `MISS` | `await startCache()` returned an already-resolved promise, racing the connect the app started at import | `startCache()` caches and returns the real `connect()` promise |
| Login `500`s when RabbitMQ is down | the publish was awaited or its rejection reached the handler | fire-and-forget `void publishEvent(...)`; transport swallows errors and returns `false` |
| Consumer stops after a reconnect | queue/bind setup ran once at boot, then the channel died | re-run registered setups via `onChannelReady()` on every connect |
| Process won't exit after tests | an AMQP socket or reconnect timer keeps the loop alive | `stopBroker()` in `afterAll`, **awaiting the in-flight connect** before closing; reconnect timers are `.unref()`ed |
| Duplicate audit rows on redelivery | consumer persisted without an idempotency key | `ON CONFLICT (event_id) DO NOTHING` + persistent `messageId` |
| Tests silently use the dev Redis DB / real broker / `.env` rate limits | `globalSetup` did `import "dotenv/config"`, and workers inherit the main process env, so `.env` beat the `??=` test defaults | parse `.env` locally in global setup without mutating `process.env`; keep test keys in `setupFiles` |
| `exit=143`, no `[shutdown]` logs | `cd dir && node app &` backgrounds the whole list, so the signal hit the shell wrapper | background Node directly and signal that PID |
| `COPY --from=build /app/dist: not found` | `WORKDIR .` resolved to `/`, not `/app` | use an absolute `WORKDIR /app` in both stages |
| Container is up but unreachable on the published port | `EXPOSE 8080`/healthcheck on 8080 while the app listens on `PORT` default 5000 | align `EXPOSE`, `HEALTHCHECK`, and `ENV PORT` |
| Container permanently `unhealthy` | healthcheck probes `/healthz`, which does not exist | probe `/health/live` (or `/health/ready`) |
| `npm ci` fails "lock file out of sync" | `package.json` changed without regenerating `package-lock.json` | run `npm install` locally and commit the lock |
| `npm run db:migrate` fails in the runtime image | script runs `tsc`, which `npm prune --omit=dev` removed | run `node dist/db/migrate.js` |
| `curl localhost:5000` refused while containers are healthy | `EXPOSE` does not publish; only `proxy` maps `8080:80` | curl `localhost:8080`, or publish the app port on a single replica |
| `compose` rejects `deploy.limits` | that key does not exist | use `deploy.resources.limits.cpus/memory` |
| `depends on undefined service app` | service is `api` but nginx/`depends_on` say `app` | make the service name, `depends_on`, and upstream agree |
| Named volume stays empty | Redis mounted at `/var/lib/data` instead of `/data` | mount `redis-data:/data` |
| Login works locally but `401`s in Compose | migrations ran but no users exist in the fresh volume | `docker compose run --rm app node dist/db/seed.js` |
| Startup logs say cache/broker unavailable | app started before Redis/RabbitMQ were ready | fail-open + reconnect; confirm via `/health/ready` → `up` |
| nginx sends traffic to a dead replica | static upstream resolved once at startup | `resolver 127.0.0.11 valid=10s` + variable `proxy_pass` |
| Fresh clone `up` fails: image `ex_ty:local` not found | Compose had only `image:`, so it tried to pull a local tag | add a `build:` block (shared by `app` and `migrate`) |
| Compose aborts with "env file not found" | `ex_ty.env` is git-ignored and absent on a fresh clone | `cp ex_ty.env.example ex_ty.env` |
| `npm install typescript-eslint` fails against TS 7 | its peer range is `<6.1.0` while this repo uses the native TS 7 | lint with `oxlint`, keep `tsc` for types |
| Unit tests suddenly need a database | `globalSetup` ran for every Jest project | give only the `integration` project a `globalSetup` |
| CI passes assertions but the suite still fails | consumer `ack`/`nack` threw on a channel closed by shutdown | wrap replies in `settle()` and ignore closed-channel errors |
| CI behaves differently from local | `.env` is absent in CI and `npm install` drifted the lockfile | set env in the workflow and install with `npm ci` |
| Container disk fills up with logs | `json-file` has no size limit by default | compose `logging` anchor: `max-size`/`max-file`/`compress` |
| nginx and app log different request IDs | app generated its own ID instead of using the proxy's | nginx sets `X-Request-ID $request_id`; app reuses the header |
| Logged `err` is `{}` | `JSON.stringify(new Error("x"))` drops non-enumerable fields | logger normalizes errors to `name`/`message`/`stack` |
| `LOG_LEVEL=silent` still prints | silent was ordered as the most verbose severity | treat silent as a negative threshold, not a level |
| Every 20s health probe appears in logs | `/health/live` was logged like user traffic | skip liveness probes in the request logger |

The recurring lesson: **most of these were runtime failures the compiler could not see.** The ones
it *could* see were fixed by keeping strict mode on and declaring query types properly.

---

## Before you use this in production

Honest gap list — this is a learning project. Coverage thresholds, structured logging, and request
IDs are now in place; close these next:

**Missing entirely**

- **Messaging reliability.** No dead-letter queue, no publisher confirms, no prefetch tuning, and no
  transactional outbox — a publish issued while the broker is down is dropped, not retried. For
  money or compliance events, persist first (outbox) and relay.
- **Refresh tokens.** Access tokens are short-lived (15m) but there is no refresh mechanism, so
  clients must re-login constantly. Use a rotating, revocable refresh token in an `HttpOnly` cookie.
- **A write path.** No `POST`/`PUT`/`DELETE` — no body validation, no CSRF/CORS-reasoning about
  state-changing requests. Adding write endpoints also moves the cache generation `INCR` from
  `seed.ts` into the write path; today seeding is the only invalidator.
- **Real migrations.** The idempotent SQL string cannot handle schema *changes* to existing data.

**Hardening**

- Rotate and vault the `JWT_SECRET`; keep it out of source entirely. Prefer RS256 if multiple
  services verify tokens.
- HTTPS/HSTS — never terminate TLS at the app *and* trust `trust proxy` incorrectly.
- CORS restricted to known origins; `cors()` with no options allows everyone.
- Request body size limits are set (100kb), but add payload-shape validation (`zod`/`valibot`) for
  bodies once you add write endpoints.
- Monitor rate-limit hits, 5xx rate, and DB pool saturation.
- Add pagination limits (`/pets` only lists; add cursor pagination for large tables).
- `requireRole` exists but no endpoint uses it yet — wire it before you add admin-only routes.
- Consider OpenAPI spec generation so your API documents itself.
- Cache hardening: negative caching is deliberately absent; add a tombstone only after measuring
   real 404 traffic. Watch for cache stampede when a hot key expires — generation invalidation is
  O(1), but a burst of concurrent misses can still all hit Postgres.
- Messaging hardening: use a non-guest AMQP user with least-privilege permissions, `amqps://` in
  transit, publisher confirms, a bounded prefetch, and a dead-letter queue for handler failures.

**Process**

- Enforce CI with branch protection and required checks once the repository is pushed.
- Add Dependabot or Renovate for dependency updates.
- Ratchet coverage thresholds upward as tests are added; inspect the uploaded artifact on failures.

---

## How to reuse this for your own project

1. **Copy the skeleton, not the domain.** Keep `config/`, `http/`, `middleware/error`, and the
   routes → controllers → repositories split. Replace `pets` with your own resources.
2. **Keep the error envelope and validators.** They are domain-independent and the highest-leverage
   parts of this repo.
3. **Add a second resource** the moment you copy it. The structure only proves itself when two
   entities live inside it — that is when you discover what belongs in shared middleware.
4. **Introduce tests before you write business logic.** A repository test and a controller test give
   you a safety net that makes refactoring cheap.
5. **Read `Pitfalls` above again** after your first sleep.

The framework choices here are replaceable — Express 5 could become Fastify or Hono tomorrow. The
ideas that transfer are: strict types from day one, one config module, SQL isolated in
repositories, a single error contract, validation at the edge, and verifying with `curl` at every
stage rather than assuming it works.
