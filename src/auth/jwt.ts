import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

import { config } from "../config/env.js";

const ISSUER = "ex_ty";
const AUDIENCE = "ex_ty_api";
const ALGORITHM = "HS256";

export type UserRole = "user" | "admin";

export type AccessTokenClaims = {
    sub: string,
    email: string,
    role: UserRole,
};

export const signAccessToken = (claims: AccessTokenClaims): string =>
    jwt.sign({ email: claims.email, role: claims.role }, config.jwtSecret, {
        subject: claims.sub,
        algorithm: ALGORITHM,
        expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"],
        issuer: ISSUER,
        audience: AUDIENCE,
    });

const isUserRole = (value: unknown): value is UserRole =>
    value === "user" || value === "admin";

export const verifyAccessToken = (token: string): AccessTokenClaims => {
    const decoded = jwt.verify(token, config.jwtSecret, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
    });

    if (typeof decoded === "string") {
        throw new Error("Unexpected token payload");
    }

    const { sub, email, role } = decoded as Record<string, unknown>;

    if (typeof sub !== "string" || typeof email !== "string" || !isUserRole(role)) {
        throw new Error("Token is missing required claims");
    }

    return { sub, email, role };
};