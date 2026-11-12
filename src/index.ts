import type { Server } from "node:http";

import { app } from "./app.js";
import { config } from "./config/env.js";
import { pool } from "./db/pool.js";
import { stopCache } from "./cache/client.js";
import { stopBroker } from "./messaging/broker.js";
import { logger } from "./logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server: Server = app.listen(config.port, (): void => {
    logger.info("server listening", { port: config.port });
});

let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("shutdown started", { signal });

    const forceExit = setTimeout(() => {
        logger.error("shutdown timed out, forcing exit", { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS });
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections();
        });

        await stopBroker();
        await stopCache();
        await pool.end();

        logger.info("shutdown complete", { signal });
        process.exit(0);
    } catch (err) {
        logger.error("shutdown failed", { signal, err });
        process.exit(1);
    }
};

process.on("SIGTERM", (): void => void shutdown("SIGTERM"));
process.on("SIGINT", (): void => void shutdown("SIGINT"));