# ex_ty

A production-shaped Express API for a pet-adoption domain, built to show how the pieces fit
together: strict TypeScript, layered HTTP code, Postgres with SQL isolated in repositories, Redis
caching, RabbitMQ audit events, a non-root Docker image, an nginx-fronted Compose stack, and a CI
pipeline that enforces tests and coverage.

`GUIDE.md` is the long-form walkthrough; this README is the quick start.

## Stack

- Node.js 22, Express 5, TypeScript 7 (native compiler), ESM
- Postgres 17 + `pg`, Redis 7, RabbitMQ 4 (`amqplib`)
- JWT access tokens, bcrypt password hashing, `express-rate-limit`
- Jest (`@swc/jest`) for unit and integration tests, oxlint, Docker, nginx, GitHub Actions

## Architecture

```
client -> nginx (:8080) -> app replicas (:5000) -> Postgres
                                          |-----> Redis (cache)
                                          |-----> RabbitMQ (audit events)
migrate (one-shot) ----------------------> Postgres
```

The app writes one JSON log line per request and echoes/propagates `X-Request-ID` so nginx access
logs and application logs can be correlated. `/health/live` is dependency-free; `/health/ready`
checks Postgres, Redis, and RabbitMQ.

## Docker quick start

Requirements: Docker with Compose v2.

```bash
cp ex_ty.env.example ex_ty.env
docker compose up -d --wait
docker compose run --rm migrate node dist/db/seed.js
```

The API is available at `http://localhost:8080`. Health checks:

```bash
curl http://localhost:8080/health/live
curl http://localhost:8080/health/ready
curl http://localhost:8080/pets
```

Compose builds `ex_ty:local`, runs migrations, starts two app replicas, and fronts them with nginx.
RabbitMQ, Postgres, and Redis are internal-only. Change the development credentials in
`ex_ty.env` before exposing anything.

Seeded logins (after running the seed command):

| Email | Password | Role |
| --- | --- | --- |
| `admin@example.com` | `admin-password-123` | admin |
| `user@example.com` | `user-password-123` | user |

## Local development

Requirements: Node.js 22+, npm, and host services on their default ports: Postgres (`5432`), Redis
(`6379`), and optionally RabbitMQ (`5672`). The Compose file does not publish database ports.

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm start
```

`npm start` builds and runs the app with nodemon on `http://localhost:5000`. The Postgres role needs
`CREATEDB` so the integration suite can create `pets_test`.

## Environment

All configuration is validated at boot in `src/config/env.ts`. `JWT_SECRET` and `DATABASE_URL` are
required; everything else has a default.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Enables production defaults when `production` |
| `PORT` | `5000` | HTTP port |
| `LOG_LEVEL` | `debug` (`info` in prod) | `error`, `warn`, `info`, `debug`, `silent` |
| `DATABASE_URL` | required | Postgres connection string |
| `JWT_SECRET` | required | HS256 signing key; 32+ chars in production |
| `JWT_EXPIRES_IN` | `15m` | Access-token lifetime |
| `BCRYPT_ROUNDS` | `10` (`12` in prod) | Password hashing cost |
| `TRUST_PROXY_HOPS` | `0` (`1` in prod) | Express `trust proxy` hops |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `100` | Global rate limit |
| `LOGIN_RATE_LIMIT_WINDOW_MS` / `LOGIN_RATE_LIMIT_MAX` | `900000` / `10` | Login rate limit |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Cache connection string |
| `CACHE_ENABLED` | `true` | Master cache switch |
| `CACHE_TTL_PETS_LIST` / `CACHE_TTL_PET_BY_ID` | `30` / `60` | Cache TTLs in seconds |
| `RABBITMQ_URL` | `amqp://localhost:5672` | AMQP connection string |
| `BROKER_ENABLED` | `true` | Publish/consume audit events |

Compose uses `ex_ty.env` (container hostnames); local dev uses `.env` (localhost). Neither file is
committed.

## API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/health/live` | none | Process liveness |
| `GET` | `/health/ready` | none | Postgres, Redis, RabbitMQ readiness |
| `GET` | `/pets` | none | Paginated list (`limit`, `offset`, `species`, `adopted`) |
| `GET` | `/pets/:id` | Bearer | Single pet |
| `POST` | `/auth/login` | none | Returns an access token |
| `GET` | `/auth/me` | Bearer | Current user |

Errors use one envelope: `{ "status": 404, "code": "NOT_FOUND", "message": "..." }`, optionally
with `details`. Successful `/pets` responses include `X-Cache: HIT | MISS | SKIP`.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Build and run with nodemon |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | oxlint over `src` and `tests` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Both Jest projects |
| `npm run test:unit` | Unit project only; no services |
| `npm run test:integration` | Integration project; Postgres + Redis, RabbitMQ optional |
| `npm run test:coverage` | All tests with coverage and thresholds |
| `npm run db:migrate` | Apply the schema |
| `npm run db:seed` | Insert demo pets and users |

## Testing

`jest.config.mjs` defines two projects:

| Project | Files | Needs |
| --- | --- | --- |
| `unit` | `tests/**/*.unit.test.ts` | nothing |
| `integration` | `tests/**/*.integration.test.ts` | Postgres, Redis (RabbitMQ optional) |

Integration `globalSetup` connects to the base database, creates `pets_test`, seeds it, and flushes
Redis DB 15. `BROKER_ENABLED=false` (the default in tests) skips the broker test; run
`BROKER_ENABLED=true npm run test:integration` to include it. Logs are silenced with
`LOG_LEVEL=silent`.

Coverage runs all 55 tests in one single-project config (`jest.coverage.config.mjs`) so Jest emits a
single report. Entry points and CLI files (`src/index.ts`, `src/db/migrate.ts`, `src/db/seed.ts`) and
type-only modules are excluded. Thresholds are set below the measured baseline: statements/lines
88%, functions 86%, branches 73%. Measure before changing them:

```bash
BROKER_ENABLED=true npm run test:coverage
```

Coverage requires the integration services and a broker for the full baseline.

## CI

`.github/workflows/ci.yml` runs on every push and pull request as one ordered job:

```
install -> lint -> typecheck -> unit tests -> tests + coverage -> build
```

Postgres, Redis, and RabbitMQ are service containers with health checks, and `BROKER_ENABLED=true`
so no test is skipped. The coverage report is uploaded as the `coverage` artifact (7 days), and
missing thresholds fail the job.

## Layout

```
src/
├── app.ts, index.ts          Express wiring and process entry
├── config/                   validated boot-time configuration
├── http/                     errors, validators, pagination, shared types
├── middleware/               auth, rate limits, error handling, request logging
├── routes/ controllers/      HTTP wiring and request/response shaping
├── repositories/             all SQL
├── cache/                    Redis transport and key policy
├── messaging/                AMQP transport, audit consumer, event envelope
├── db/                       pool, schema, migrate, seed
├── auth/                     password hashing and JWT
└── logger.ts                 dependency-free JSON logger
tests/
├── *.unit.test.ts            pure logic
├── *.integration.test.ts     supertest against the app
└── setup/                    env defaults and DB/Redis global setup
```

## Security notes

This is a learning project. Before production: rotate and vault `JWT_SECRET`, terminate TLS with
HSTS, restrict CORS to known origins, use versioned migrations, add refresh tokens and write
endpoints with body validation, and add publisher confirms/DLQ/outbox for messaging. See
“Before you use this in production” in `GUIDE.md` for the full list.
