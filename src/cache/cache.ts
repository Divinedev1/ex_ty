import { config } from "../config/env.js";
import { getFromRedis, setInRedis, delFromRedis, incrInRedis, isCacheReady } from "./client.js";

export type CacheStatus = "HIT" | "MISS" | "SKIP";

const PETS_GENERATION_KEY = "pets:generation";

export const isCacheActive = (): boolean =>
    config.cache.enabled && isCacheReady();

export const cacheRead = async <T>(key: string): Promise<T | undefined> => {
    if (!config.cache.enabled) return undefined;

    const raw = await getFromRedis(key);

    if (raw === null) return undefined;

    try {
        return JSON.parse(raw) as T;
    } catch {
        await delFromRedis(key);
        return undefined;
    }
};

export const cacheWrite = async (
    key: string,
    value: unknown,
    ttlSeconds: number,
): Promise<void> => {
    if (!config.cache.enabled) return;

    await setInRedis(key, JSON.stringify(value), ttlSeconds);
};

export const petsGeneration = async (): Promise<string> => {
    const generation = await getFromRedis(PETS_GENERATION_KEY);

    return generation ?? "0";
};

export const petsPrefix = async (): Promise<string> => {
    const generation = await petsGeneration();

    return `pets:${generation}`;
};

const encodeParams = (params: Record<string, string | number | boolean | undefined>): string =>
    Object.keys(params)
        .sort()
        .filter((key) => params[key] !== undefined)
        .map((key) => `${key}=${encodeURIComponent(String(params[key]))}`)
        .join("&");

export const buildPetsListKey = async (
    params: Record<string, string | number | boolean | undefined>,
): Promise<string> =>
    `${await petsPrefix()}:list:${encodeParams(params)}`;

export const buildPetsIdKey = async (id: number): Promise<string> =>
    `${await petsPrefix()}:id:${id}`;

export const invalidatePetsCache = async (): Promise<void> => {
    await incrInRedis(PETS_GENERATION_KEY);
};
