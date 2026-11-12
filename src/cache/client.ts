import { createClient } from "redis";

import { config } from "../config/env.js";
import { logger } from "../logger.js";

const createRedisClient = () =>
    createClient({
        url: config.cache.url,
        socket: {
            reconnectStrategy: (retries: number): number | false =>
                Math.min(retries * 100, 3_000),
        },
    });

type RedisClient = ReturnType<typeof createRedisClient>;

let client: RedisClient | undefined;
let connectPromise: Promise<void> | undefined;
let warned = false;
let started = false;

const warn = (err: unknown): void => {
    if (warned) return;
    warned = true;
    logger.warn("cache unavailable, falling back to database", { err });
};

const reset = (): void => {
    warned = false;
};

const connected = (): RedisClient | undefined =>
    client?.isReady === true ? client : undefined;

export const startCache = (): Promise<void> => {
    if (started) return connectPromise ?? Promise.resolve();
    started = true;

    if (!config.cache.enabled) {
        logger.info("cache disabled by CACHE_ENABLED=false");
        return Promise.resolve();
    }

    const next = createRedisClient();

    next.on("error", warn);
    next.on("ready", reset);

    client = next;

    connectPromise = next.connect().then(
        () => undefined,
        (err) => warn(err),
    );

    return connectPromise;
};

export const isCacheReady = (): boolean =>
    connected() !== undefined;

export const getFromRedis = async (key: string): Promise<string | null> => {
    const redis = connected();
    if (redis === undefined) return null;

    try {
        return await redis.get(key);
    } catch (err) {
        warn(err);
        return null;
    }
};

export const setInRedis = async (
    key: string,
    value: string,
    ttlSeconds: number,
): Promise<void> => {
    const redis = connected();
    if (redis === undefined) return;

    try {
        await redis.set(key, value, {
            expiration: { type: "EX", value: ttlSeconds },
        });
    } catch (err) {
        warn(err);
    }
};

export const delFromRedis = async (...keys: string[]): Promise<void> => {
    const redis = connected();
    if (redis === undefined || keys.length === 0) return;

    try {
        await redis.del(keys);
    } catch (err) {
        warn(err);
    }
};

export const incrInRedis = async (key: string): Promise<void> => {
    const redis = connected();
    if (redis === undefined) return;

    try {
        await redis.incr(key);
    } catch (err) {
        warn(err);
    }
};

export const stopCache = async (): Promise<void> => {
    if (client === undefined) return;

    const closing = client;
    client = undefined;
    connectPromise = undefined;
    started = false;

    try {
        await closing.quit();
    } catch {
        closing.destroy();
    }
};
