import { rateLimit } from "express-rate-limit";
import type { RateLimitRequestHandler } from "express-rate-limit";

import { config } from "../config/env.js";

const respond = (message: string) =>
    (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void => {
        res.status(429).json({
            status: 429,
            code: "RATE_LIMITED",
            message,
        });
    };

export const globalLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: respond("Too many requests, please try again later"),
});

export const loginLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: config.rateLimit.loginWindowMs,
    limit: config.rateLimit.loginMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: respond("Too many login attempts, please try again later"),
});