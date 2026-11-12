export type ErrorCode =
    | "VALIDATION_ERROR"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "MALFORMED_JSON"
    | "PAYLOAD_TOO_LARGE"
    | "RATE_LIMITED"
    | "DATABASE_ERROR"
    | "INTERNAL_ERROR";

export type ErrorDetails = Record<string, string>;

export type ErrorBody = {
    status: number,
    code: ErrorCode,
    message: string,
    details?: ErrorDetails,
}

export class ApiError extends Error {
    readonly status: number;
    readonly code: ErrorCode;
    readonly details?: ErrorDetails;

    constructor(status: number, code: ErrorCode, message: string, details?: ErrorDetails) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const badRequest = (message: string, details?: ErrorDetails): ApiError =>
    new ApiError(400, "VALIDATION_ERROR", message, details);

export const unauthorized = (message: string): ApiError =>
    new ApiError(401, "UNAUTHORIZED", message);

export const notFound = (message: string): ApiError =>
    new ApiError(404, "NOT_FOUND", message);

export const toErrorBody = (err: ApiError): ErrorBody => ({
    status: err.status,
    code: err.code,
    message: err.message,
    ...(err.details !== undefined ? { details: err.details } : {}),
});