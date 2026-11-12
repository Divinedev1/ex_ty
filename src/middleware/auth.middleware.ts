import type { Request, Response, NextFunction } from "express";

import { verifyAccessToken } from "../auth/jwt.js";
import type { UserRole } from "../auth/jwt.js";
import { ApiError } from "../http/errors.js";

const extractBearerToken = (req: Request): string | undefined => {
    const header = req.headers.authorization;

    if (header === undefined) return undefined;

    const [scheme, token] = header.split(" ");

    if (scheme?.toLowerCase() !== "bearer" || token === undefined || token === "") {
        return undefined;
    }

    return token;
};

export const requireAuth = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    const token = extractBearerToken(req);

    if (token === undefined) {
        next(new ApiError(401, "UNAUTHORIZED", "Missing or malformed Authorization header"));
        return;
    }

    let claims;
    try {
        claims = verifyAccessToken(token);
    } catch {
        next(new ApiError(401, "UNAUTHORIZED", "Invalid or expired token"));
        return;
    }

    req.user = {
        id: Number(claims.sub),
        email: claims.email,
        role: claims.role,
    };

    next();
};

export const requireRole = (...allowed: UserRole[]) =>
    (req: Request, _res: Response, next: NextFunction): void => {
        if (req.user === undefined) {
            next(new ApiError(401, "UNAUTHORIZED", "Authentication required"));
            return;
        }

        if (!allowed.includes(req.user.role)) {
            next(new ApiError(403, "FORBIDDEN", "Insufficient permissions"));
            return;
        }

        next();
    };