import amqp from "amqplib";
import type { Channel, ChannelModel } from "amqplib";

import { config } from "../config/env.js";
import { logger } from "../logger.js";

export const EVENTS_EXCHANGE = "ex_ty.events";

type ChannelSetup = (channel: Channel) => Promise<void>;

const setups: ChannelSetup[] = [];

let connection: ChannelModel | undefined;
let channel: Channel | undefined;
let connectPromise: Promise<void> | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;
let warned = false;
let started = false;
let stopping = false;
let attempts = 0;

const warn = (err: unknown): void => {
    if (warned) return;
    warned = true;
    logger.warn("broker unavailable, events will be dropped", { err });
};

const scheduleReconnect = (): void => {
    if (stopping || reconnectTimer !== undefined) return;

    attempts += 1;
    const delay = Math.min(attempts * 500, 5_000);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void tryConnect();
    }, delay);
    reconnectTimer.unref();
};

const connect = async (): Promise<void> => {
    const next = await amqp.connect(config.broker.url);

    if (stopping) {
        await next.close().catch(() => undefined);
        return;
    }

    next.on("error", warn);
    next.on("close", () => {
        if (connection !== next) return;

        connection = undefined;
        channel = undefined;
        connectPromise = undefined;
        scheduleReconnect();
    });

    const ch = await next.createChannel();
    ch.on("error", warn);
    await ch.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });

    for (const setup of setups) {
        await setup(ch);
    }

    connection = next;
    channel = ch;
    attempts = 0;
    warned = false;
};

const tryConnect = (): Promise<void> => {
    if (connectPromise !== undefined) return connectPromise;

    connectPromise = connect().then(
        () => undefined,
        (err) => {
            warn(err);
            connectPromise = undefined;
            scheduleReconnect();
        },
    );

    return connectPromise;
};

export const startBroker = (): Promise<void> => {
    if (started) return connectPromise ?? Promise.resolve();
    started = true;

    if (!config.broker.enabled) {
        logger.info("broker disabled by BROKER_ENABLED=false");
        return Promise.resolve();
    }

    return tryConnect();
};

export const isBrokerReady = (): boolean => channel !== undefined;

export const onChannelReady = (setup: ChannelSetup): void => {
    setups.push(setup);

    if (channel !== undefined) {
        void setup(channel).catch(warn);
    }
};

export const publishEvent = async (
    routingKey: string,
    event: { eventId: string },
): Promise<boolean> => {
    if (channel === undefined) return false;

    try {
        return channel.publish(
            EVENTS_EXCHANGE,
            routingKey,
            Buffer.from(JSON.stringify(event)),
            {
                persistent: true,
                contentType: "application/json",
                messageId: event.eventId,
                timestamp: Date.now(),
            },
        );
    } catch (err) {
        warn(err);
        return false;
    }
};

export const stopBroker = async (): Promise<void> => {
    stopping = true;

    if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }

    const pending = connectPromise;
    connectPromise = undefined;
    started = false;

    if (pending !== undefined) {
        await pending;
    }

    const closing = connection;
    connection = undefined;
    channel = undefined;

    if (closing !== undefined) {
        await closing.close().catch(() => undefined);
    }

    stopping = false;
};