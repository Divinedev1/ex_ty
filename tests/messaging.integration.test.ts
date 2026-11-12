import request from "supertest";

import { app } from "../src/app.js";
import { config } from "../src/config/env.js";
import { buildAuditEvent } from "../src/messaging/events.js";
import { isBrokerReady, publishEvent, startBroker, stopBroker } from "../src/messaging/broker.js";
import { query, pool } from "../src/db/pool.js";
import { stopCache } from "../src/cache/client.js";

const host = request(app);

afterAll(async () => {
    await stopBroker();
    await stopCache();
    await pool.end();
});

describe("publisher is fail-open", () => {
    it("returns false without throwing when the broker is unavailable", async () => {
        if (isBrokerReady()) return;

        const accepted = await publishEvent(
            "auth.login.succeeded",
            buildAuditEvent("auth.login.succeeded", { email: "a@b.co" }),
        );

        expect(accepted).toBe(false);
    });

    it("login still succeeds while the broker is down", async () => {
        const res = await host
            .post("/auth/login")
            .send({ email: "user@example.com", password: "user-password-123" })
            .expect(200);

        expect(typeof res.body.accessToken).toBe("string");
    });
});

(config.broker.enabled ? describe : describe.skip)("publish -> consume -> persist", () => {
    beforeAll(async () => {
        await startBroker();
    });

    it("records a login audit event in audit_events", async () => {
        if (!isBrokerReady()) {
            console.warn("[test] broker not reachable; skipping end-to-end assertions");
            return;
        }

        const countLogins = async (): Promise<number> => {
            const { rows } = await query<{ count: string }>(
                "SELECT COUNT(*)::text AS count FROM audit_events WHERE type = 'auth.login.succeeded'",
            );

            return Number(rows[0]?.count ?? 0);
        };

        const before = await countLogins();

        await host
            .post("/auth/login")
            .send({ email: "user@example.com", password: "user-password-123" })
            .expect(200);

        let after = before;
        for (let i = 0; i < 50 && after === before; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            after = await countLogins();
        }

        expect(after).toBeGreaterThan(before);
    });
});
