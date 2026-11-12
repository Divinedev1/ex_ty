import { query } from "../db/pool.js";
import type { AuditEvent } from "../messaging/events.js";

export const recordAuditEvent = async (event: AuditEvent): Promise<void> => {
    await query(
        `INSERT INTO audit_events (event_id, type, payload, occurred_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING`,
        [event.eventId, event.type, JSON.stringify(event.payload), event.occurredAt],
    );
};