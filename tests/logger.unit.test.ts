import { formatLogEntry } from "../src/logger.js";

describe("structured logger", () => {
    it("serializes level, time, message, and context", () => {
        const entry = JSON.parse(formatLogEntry("info", "hello", {
            requestId: "abc",
            count: 1,
        })) as Record<string, unknown>;

        expect(entry).toMatchObject({
            level: "info",
            msg: "hello",
            requestId: "abc",
            count: 1,
        });
        expect(typeof entry.time).toBe("string");
        expect(!Number.isNaN(Date.parse(String(entry.time)))).toBe(true);
    });

    it("serializes Error values instead of dropping them", () => {
        const entry = JSON.parse(formatLogEntry("error", "boom", {
            err: new Error("nope"),
        })) as Record<string, unknown>;

        expect(entry.err).toMatchObject({
            name: "Error",
            message: "nope",
        });
    });
});
