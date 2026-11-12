import type { Channel, ConsumeMessage } from "amqplib";

import { EVENTS_EXCHANGE, onChannelReady } from "./broker.js";
import { parseAuditEvent } from "./events.js";
import { recordAuditEvent } from "../repositories/audit.repository.js";
import { logger } from "../logger.js";

const AUDIT_QUEUE = "ex_ty.audit";
const AUDIT_BINDING = "auth.#";

const settle = (reply: () => void): void => {
    try {
        reply();
    } catch {
        return;
    }
};

const handle = async (channel: Channel, message: ConsumeMessage): Promise<void> => {
    const event = parseAuditEvent(message.content.toString());

    if (event === undefined) {
        settle(() => channel.ack(message));
        return;
    }

    try {
        await recordAuditEvent(event);
        settle(() => channel.ack(message));
    } catch (err) {
        logger.error("failed to record audit event", {
            eventId: event.eventId,
            type: event.type,
            err,
        });
        settle(() => channel.nack(message, false, false));
    }
};

export const registerAuditConsumer = (): void => {
    onChannelReady(async (channel) => {
        await channel.assertQueue(AUDIT_QUEUE, { durable: true });
        await channel.bindQueue(AUDIT_QUEUE, EVENTS_EXCHANGE, AUDIT_BINDING);
        await channel.consume(
            AUDIT_QUEUE,
            (message) => {
                if (message !== null) void handle(channel, message);
            },
            { noAck: false },
        );
    });
};