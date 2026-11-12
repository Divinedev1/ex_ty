import { buildAuditEvent, parseAuditEvent } from "../src/messaging/events.js";

describe("audit event envelope", () => {
    it("builds a unique, well-formed event", () => {
        const first = buildAuditEvent("auth.login.succeeded", {
            email: "user@example.com",
            userId: 2,
            role: "user",
        });
        const second = buildAuditEvent("auth.login.succeeded", { email: "user@example.com" });

        expect(first.eventId).not.toBe(second.eventId);
        expect(first.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(!Number.isNaN(Date.parse(first.occurredAt))).toBe(true);
        expect(first.type).toBe("auth.login.succeeded");
        expect(first.payload).toEqual({ email: "user@example.com", userId: 2, role: "user" });
    });

    it("round-trips through parseAuditEvent", () => {
        const event = buildAuditEvent("auth.login.failed", {
            email: "x@y.z",
            reason: "unknown_email",
        });

        expect(parseAuditEvent(JSON.stringify(event))).toEqual(event);
    });

    it("rejects malformed payloads", () => {
        expect(parseAuditEvent("not-json")).toBeUndefined();
        expect(parseAuditEvent(JSON.stringify({ type: "auth.login.failed" }))).toBeUndefined();
        expect(parseAuditEvent(JSON.stringify({
            eventId: "1",
            type: "not.an.event",
            occurredAt: "",
            payload: { email: "a@b.co" },
        }))).toBeUndefined();
        expect(parseAuditEvent(JSON.stringify({
            eventId: "1",
            type: "auth.login.failed",
            occurredAt: "",
            payload: {},
        }))).toBeUndefined();
    });
});
