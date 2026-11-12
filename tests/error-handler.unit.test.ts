import { DatabaseError } from "pg";

import { ApiError } from "../src/http/errors.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

describe("errorHandler unit mapping", () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status } as unknown as Parameters<typeof errorHandler>[2];

    const call = (err: unknown): void => {
        errorHandler(
            err,
            {} as Parameters<typeof errorHandler>[1],
            res,
            () => undefined,
        );
    };

    beforeEach(() => {
        json.mockReset();
        status.mockReset();
        status.mockReturnValue({ json });
    });

    it("renders ApiError exactly", () => {
        call(new ApiError(404, "NOT_FOUND", "No pet with that ID"));

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({
            status: 404,
            code: "NOT_FOUND",
            message: "No pet with that ID",
        });
    });

    it("maps malformed JSON bodies to 400", () => {
        const err = Object.assign(new Error("Unexpected token"), {
            type: "entity.parse.failed",
        });
        call(err);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            status: 400,
            code: "MALFORMED_JSON",
            message: "Request body is not valid JSON",
        });
    });

    it("maps oversized bodies to 413", () => {
        const err = Object.assign(new Error("request entity too large"), {
            type: "entity.too.large",
        });
        call(err);

        expect(status).toHaveBeenCalledWith(413);
        expect(json).toHaveBeenCalledWith({
            status: 413,
            code: "PAYLOAD_TOO_LARGE",
            message: "Request body is too large",
        });
    });

    it("maps a duplicate-key SQL error to 409", () => {
        const err = new DatabaseError("duplicate key value", 20, "error");
        err.code = "23505";
        call(err);

        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "DATABASE_ERROR" }));
    });

    it("treats unknown SQL codes as 500", () => {
        const err = new DatabaseError("internal error", 14, "error");
        err.code = "XX000";
        call(err);

        expect(status).toHaveBeenCalledWith(500);
    });

    it("maps pg connection refusal to 503", () => {
        const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
            code: "ECONNREFUSED",
        });
        call(err);

        expect(status).toHaveBeenCalledWith(503);
        expect(json).toHaveBeenCalledWith({
            status: 503,
            code: "DATABASE_ERROR",
            message: "Database unavailable",
        });
    });

    it("maps a pg connection timeout to 503", () => {
        call(new Error("Connection terminated due to connection timeout"));

        expect(status).toHaveBeenCalledWith(503);
    });

    it("renders anything unknown as a 500", () => {
        call(new Error("boom"));

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            status: 500,
            code: "INTERNAL_ERROR",
            message: "Internal server error",
        });
    });
});
