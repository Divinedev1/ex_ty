import type { ErrorRequestHandler } from "express";
import { DatabaseError } from "pg";

import { ApiError, toErrorBody } from "../http/errors.js";
import type { ErrorBody, ErrorCode } from "../http/errors.js";
import { logger } from "../logger.js";

const PG_ERROR_STATUS: Record<string, number> = {
    "22P02": 400,
    "22001": 400,
    "23502": 400,
    "23505": 409,
    "23503": 409,
    "23514": 400,
};

const CONNECTION_ERROR_CODES = new Set([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNRESET",
    "ENETUNREACH",
    "ENETDOWN",
    "EHOSTUNREACH",
]);

const hasConnectionErrorCode = (err: unknown): err is Error & { code: string } =>
    err instanceof Error
    && typeof (err as Error & { code?: unknown }).code === "string"
    && CONNECTION_ERROR_CODES.has((err as Error & { code: string }).code);

const isConnectionError = (err: unknown): boolean =>
    hasConnectionErrorCode(err)
    || (err instanceof Error && err.message === "Connection terminated due to connection timeout");

type BodyParserError = Error & {
    type?: string,
    status?: number,
};

const isBodyParserError = (err: unknown): err is BodyParserError =>
    err instanceof Error
    && typeof (err as BodyParserError).type === "string"
    && (err as BodyParserError).type?.startsWith("entity.") === true;

const send = (res: Parameters<ErrorRequestHandler>[2], status: number, code: ErrorCode, message: string): void => {
    const body: ErrorBody = { status, code, message };
    res.status(status).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next): void => {
    const requestId = res.locals?.requestId as string | undefined;
    const context = { requestId, method: req.method, path: req.originalUrl };

    if (err instanceof ApiError) {
        res.status(err.status).json(toErrorBody(err));
        return;
    }

    if (isBodyParserError(err)) {
        if (err.type === "entity.too.large") {
            send(res, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
            return;
        }

        send(res, 400, "MALFORMED_JSON", "Request body is not valid JSON");
        return;
    }

    if (isConnectionError(err)) {
        logger.error("database connection error", { ...context, status: 503, err });
        send(res, 503, "DATABASE_ERROR", "Database unavailable");
        return;
    }

    if (err instanceof DatabaseError) {
        const status = PG_ERROR_STATUS[err.code ?? ""] ?? 500;
        logger.error("database error", { ...context, status, code: err.code, err });

        send(res, status, "DATABASE_ERROR", status >= 500 ? "Database error" : "Invalid request");
        return;
    }

    logger.error("unhandled error", { ...context, status: 500, err });
    send(res, 500, "INTERNAL_ERROR", "Internal server error");
};