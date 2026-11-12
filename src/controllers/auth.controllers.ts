import type { Request, Response } from "express";

import { findUserByEmail, findUserById } from "../repositories/users.repository.js";
import { verifyPassword } from "../auth/password.js";
import { signAccessToken } from "../auth/jwt.js";
import { config } from "../config/env.js";
import { badRequest, unauthorized } from "../http/errors.js";
import { publishEvent } from "../messaging/broker.js";
import { buildAuditEvent } from "../messaging/events.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7a92Oa3Uv7f7qMQcxGPmvAG";

type LoginBody = {
    email?: string,
    password?: string,
}

type LoginResponse = {
    accessToken: string,
    tokenType: "Bearer",
    expiresIn: string,
    user: {
        id: number,
        email: string,
        role: string,
    },
}

export const login = async (
    req: Request<Record<string, never>, LoginResponse, LoginBody, Record<string, never>>,
    res: Response<LoginResponse>
): Promise<void> => {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
        throw badRequest("email must be a valid email address", { field: "email" });
    }

    if (typeof password !== "string" || password.length === 0) {
        throw badRequest("password is required", { field: "password" });
    }

    const user = await findUserByEmail(email);

    const passwordMatches = await verifyPassword(
        password,
        user?.passwordHash ?? DUMMY_HASH,
    );

    if (user === undefined || !passwordMatches) {
        void publishEvent("auth.login.failed", buildAuditEvent("auth.login.failed", {
            email,
            ...(user !== undefined ? { userId: user.id, role: user.role } : {}),
            reason: user === undefined ? "unknown_email" : "bad_password",
        }));

        throw unauthorized("Invalid email or password");
    }

    void publishEvent("auth.login.succeeded", buildAuditEvent("auth.login.succeeded", {
        email: user.email,
        userId: user.id,
        role: user.role,
    }));

    res.json({
        accessToken: signAccessToken({
            sub: String(user.id),
            email: user.email,
            role: user.role,
        }),
        tokenType: "Bearer",
        expiresIn: config.jwtExpiresIn,
        user: { id: user.id, email: user.email, role: user.role },
    });
};

export const me = async (
    req: Request,
    res: Response<{ id: number, email: string, role: string }>
): Promise<void> => {
    if (req.user === undefined) {
        throw unauthorized("Authentication required");
    }

    const user = await findUserById(req.user.id);

    if (user === undefined) {
        throw unauthorized("User no longer exists");
    }

    res.json({ id: user.id, email: user.email, role: user.role });
};