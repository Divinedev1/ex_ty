import { randomUUID } from "node:crypto";

import type { Request, Response, NextFunction } from "express";

import { logger } from "../logger.js";

const takeRequestId = (req: Request): string | undefined => {
    const header = req.get("x-request-id");

    if (header === undefined) return undefined;

    const trimmed = header.trim();

    return /^[A-Za-z0-9._-]{1,128}$/.test(trimmed) ? trimmed : undefined;
};

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    const requestId = takeRequestId(req) ?? randomUUID();
    const startedAt = process.hrtime.bigint();
    const probe = req.path === "/health/live";

    res.locals.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);

    res.on("finish", (): void => {
        if (probe) return;

        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        logger.info("request completed", {
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Math.round(durationMs * 1_000) / 1_000,
        });
    });

    next();
};
