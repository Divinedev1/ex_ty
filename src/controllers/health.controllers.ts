import type { Request, Response } from "express";

import { config } from "../config/env.js";
import { query } from "../db/pool.js";
import { isCacheReady } from "../cache/client.js";
import { isBrokerReady } from "../messaging/broker.js";

type DependencyState = "up" | "down" | "disabled";

type ReadinessBody = {
    status: "ready" | "not_ready",
    uptime: number,
    checks: {
        database: DependencyState,
        cache: DependencyState,
        broker: DependencyState,
    },
}

const DB_PROBE_TIMEOUT_MS = 2_000;

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | undefined> => {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
        timer.unref();
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
};

const databaseState = async (): Promise<DependencyState> => {
    try {
        const result = await withTimeout(query("SELECT 1"), DB_PROBE_TIMEOUT_MS);
        return result === undefined ? "down" : "up";
    } catch {
        return "down";
    }
};

const cacheState = (): DependencyState => {
    if (!config.cache.enabled) return "disabled";
    return isCacheReady() ? "up" : "down";
};

const brokerState = (): DependencyState => {
    if (!config.broker.enabled) return "disabled";
    return isBrokerReady() ? "up" : "down";
};

export const getLiveness = (_req: Request, res: Response): void => {
    res.json({ status: "ok", uptime: process.uptime() });
};

export const getReadiness = async (
    _req: Request,
    res: Response<ReadinessBody>,
): Promise<void> => {
    const database = await databaseState();

    const ready = database === "up";

    res.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "not_ready",
        uptime: process.uptime(),
        checks: {
            database,
            cache: cacheState(),
            broker: brokerState(),
        },
    });
};