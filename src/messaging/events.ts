import { randomUUID } from "node:crypto";

export type AuditEventType =
    | "auth.login.succeeded"
    | "auth.login.failed";

export type AuditEventPayload = {
    email: string,
    userId?: number,
    role?: string,
    reason?: string,
}

export type AuditEvent = {
    eventId: string,
    type: AuditEventType,
    occurredAt: string,
    payload: AuditEventPayload,
}

const AUDIT_TYPES: ReadonlySet<string> = new Set<AuditEventType>([
    "auth.login.succeeded",
    "auth.login.failed",
]);

export const buildAuditEvent = (
    type: AuditEventType,
    payload: AuditEventPayload,
): AuditEvent => ({
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    payload,
});

export const parseAuditEvent = (raw: string): AuditEvent | undefined => {
    let value: unknown;

    try {
        value = JSON.parse(raw);
    } catch {
        return undefined;
    }

    if (typeof value !== "object" || value === null) return undefined;

    const event = value as Record<string, unknown>;
    const payload = event.payload;

    if (
        typeof event.eventId !== "string"
        || typeof event.type !== "string"
        || !AUDIT_TYPES.has(event.type)
        || typeof event.occurredAt !== "string"
        || typeof payload !== "object"
        || payload === null
    ) {
        return undefined;
    }

    const body = payload as Record<string, unknown>;

    if (typeof body.email !== "string") return undefined;

    return {
        eventId: event.eventId,
        type: event.type as AuditEventType,
        occurredAt: event.occurredAt,
        payload: {
            email: body.email,
            ...(typeof body.userId === "number" ? { userId: body.userId } : {}),
            ...(typeof body.role === "string" ? { role: body.role } : {}),
            ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
        },
    };
};