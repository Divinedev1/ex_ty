const fail = (message: string): never => {
    throw new Error(`Invalid configuration: ${message}`);
};

const required = (name: string): string => {
    const value = process.env[name];

    if (value === undefined || value.trim() === "") {
        return fail(`${name} is required but was not set`);
    }

    return value;
};

const asInt = (name: string, fallback: number): number => {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") return fallback;

    const parsed = Number(raw);

    if (!Number.isInteger(parsed)) {
        return fail(`${name} must be an integer, received "${raw}"`);
    }

    return parsed;
};

const asBool = (name: string, fallback: boolean): boolean => {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") return fallback;

    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;

    return fail(`${name} must be true or false, received "${raw}"`);
};

const LOG_LEVELS = ["error", "warn", "info", "debug", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const asLogLevel = (name: string, fallback: LogLevel): LogLevel => {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") return fallback;

    if ((LOG_LEVELS as readonly string[]).includes(raw)) return raw as LogLevel;

    return fail(`${name} must be one of ${LOG_LEVELS.join(", ")}, received "${raw}"`);
};

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

const jwtSecret = required("JWT_SECRET");

if (isProduction && jwtSecret.length < 32) {
    fail("JWT_SECRET must be at least 32 characters in production");
}

const trustProxy = asInt("TRUST_PROXY_HOPS", isProduction ? 1 : 0);

export const config = {
    nodeEnv,
    isProduction,
    port: asInt("PORT", 5000),
    databaseUrl: required("DATABASE_URL"),
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
    logLevel: asLogLevel("LOG_LEVEL", isProduction ? "info" : "debug"),
    trustProxy,
    bcryptRounds: asInt("BCRYPT_ROUNDS", isProduction ? 12 : 10),
    rateLimit: {
        windowMs: asInt("RATE_LIMIT_WINDOW_MS", 60_000),
        max: asInt("RATE_LIMIT_MAX", 100),
        loginWindowMs: asInt("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60_000),
        loginMax: asInt("LOGIN_RATE_LIMIT_MAX", 10),
    },
    cache: {
        enabled: asBool("CACHE_ENABLED", true),
        url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
        ttlPetsList: asInt("CACHE_TTL_PETS_LIST", 30),
        ttlPetById: asInt("CACHE_TTL_PET_BY_ID", 60),
    },
    broker: {
        enabled: asBool("BROKER_ENABLED", true),
        url: process.env.RABBITMQ_URL ?? "amqp://localhost:5672",
    },
} as const;