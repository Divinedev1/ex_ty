import request from "supertest";

import { app } from "../src/app.js";
import { stopCache } from "../src/cache/client.js";
import { stopBroker } from "../src/messaging/broker.js";
import { pool } from "../src/db/pool.js";

const host = request(app);

afterAll(async () => {
    await stopBroker();
    await stopCache();
    await pool.end();
});

describe("error envelope over HTTP", () => {
    it("returns the envelope for unknown routes", async () => {
        const res = await host.get("/does-not-exist");

        expect(res.status).toBe(404);
        expect(res.body).toEqual({
            status: 404,
            code: "NOT_FOUND",
            message: "No route found",
        });
    });

    it("rejects malformed JSON bodies", async () => {
        const res = await host
            .post("/auth/login")
            .set("Content-Type", "application/json")
            .send('{"email":');

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("MALFORMED_JSON");
    });

    it("rejects oversized bodies", async () => {
        const huge = { email: "x".repeat(200_000), password: "y" };
        const res = await host.post("/auth/login").send(huge);

        expect(res.status).toBe(413);
        expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    });
});
