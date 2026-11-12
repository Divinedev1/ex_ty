import request from "supertest";

import { app } from "../src/app.js";
import { config } from "../src/config/env.js";
import { startCache, stopCache } from "../src/cache/client.js";
import { stopBroker } from "../src/messaging/broker.js";
import { pool } from "../src/db/pool.js";

const host = request(app);

beforeAll(async () => {
    await startCache();
});

afterAll(async () => {
    await stopBroker();
    await stopCache();
    await pool.end();
});

describe("health endpoints", () => {
    it("reports liveness without depending on downstream services", async () => {
        const res = await host.get("/health/live").expect(200);

        expect(res.body.status).toBe("ok");
        expect(typeof res.body.uptime).toBe("number");
    });

    it("reports readiness and the state of each dependency", async () => {
        const res = await host.get("/health/ready").expect(200);

        expect(res.body.status).toBe("ready");
        expect(res.body.checks.database).toBe("up");
        expect(["up", "down"]).toContain(res.body.checks.cache);
        expect(config.broker.enabled ? ["up", "down"] : ["disabled"])
            .toContain(res.body.checks.broker);
    });

    it("is mounted outside the global rate limiter", async () => {
        for (let i = 0; i < 20; i += 1) {
            await host.get("/health/live").expect(200);
        }
    });

    it("still returns the error envelope for unknown routes", async () => {
        const res = await host.get("/health/unknown").expect(404);

        expect(res.body.code).toBe("NOT_FOUND");
    });
});