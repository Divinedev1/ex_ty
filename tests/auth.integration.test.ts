import request from "supertest";
import jwt from "jsonwebtoken";

import { app } from "../src/app.js";
import { config } from "../src/config/env.js";
import { stopCache } from "../src/cache/client.js";
import { stopBroker } from "../src/messaging/broker.js";
import { pool } from "../src/db/pool.js";

const host = request(app);

afterAll(async () => {
    await stopBroker();
    await stopCache();
    await pool.end();
});

describe("POST /auth/login", () => {
    it("issues an access token for valid credentials", async () => {
        const res = await host
            .post("/auth/login")
            .send({ email: "user@example.com", password: "user-password-123" })
            .expect(200);

        expect(typeof res.body.accessToken).toBe("string");
        expect(res.body.accessToken.length).toBeGreaterThan(20);
        expect(res.body.tokenType).toBe("Bearer");
        expect(res.body.expiresIn).toBe("15m");
        expect(res.body.user).toEqual({
            id: 2,
            email: "user@example.com",
            role: "user",
        });
    });

    it("rejects a wrong password with a generic message", async () => {
        const res = await host
            .post("/auth/login")
            .send({ email: "user@example.com", password: "wrong-password" });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            status: 401,
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
        });
    });

    it("rejects an unknown email with the same message (no user enumeration)", async () => {
        const res = await host
            .post("/auth/login")
            .send({ email: "nobody@example.com", password: "wrong-password" });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe("Invalid email or password");
    });

    it("exposes the admin role for admin credentials", async () => {
        const res = await host
            .post("/auth/login")
            .send({ email: "admin@example.com", password: "admin-password-123" })
            .expect(200);

        expect(res.body.user.role).toBe("admin");
    });
});

describe("GET /auth/me", () => {
    let token = "";

    beforeAll(async () => {
        const res = await host
            .post("/auth/login")
            .send({ email: "user@example.com", password: "user-password-123" });
        token = res.body.accessToken as string;
    });

    it("returns the caller for a valid token", async () => {
        const res = await host
            .get("/auth/me")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(res.body).toEqual({ id: 2, email: "user@example.com", role: "user" });
    });

    it("rejects a missing header", async () => {
        const res = await host.get("/auth/me");

        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
    });

    it("rejects a malformed token", async () => {
        const res = await host
            .get("/auth/me")
            .set("Authorization", "Bearer not-a-jwt");

        expect(res.status).toBe(401);
    });

    it("rejects an expired token", async () => {
        const expired = jwt.sign(
            { email: "user@example.com", role: "user" },
            config.jwtSecret,
            {
                subject: "2",
                algorithm: "HS256",
                expiresIn: -10,
                issuer: "ex_ty",
                audience: "ex_ty_api",
            },
        );

        const res = await host
            .get("/auth/me")
            .set("Authorization", `Bearer ${expired}`)
            .expect(401);

        expect(res.body.code).toBe("UNAUTHORIZED");
    });

    it("rejects a token signed with the wrong key", async () => {
        const forged = jwt.sign(
            { email: "user@example.com", role: "user" },
            "attacker-secret-that-is-not-the-real-one",
            {
                subject: "2",
                algorithm: "HS256",
                expiresIn: "15m",
                issuer: "ex_ty",
                audience: "ex_ty_api",
            },
        );

        await host
            .get("/auth/me")
            .set("Authorization", `Bearer ${forged}`)
            .expect(401);
    });
});

describe("POST /auth/login rate limiting", () => {
    it("starts returning 429 after enough failed attempts", async () => {
        let limited = false;

        for (let i = 0; i < 12 && !limited; i += 1) {
            const res = await host
                .post("/auth/login")
                .send({ email: "user@example.com", password: "wrong-password" });

            if (res.status === 429) limited = true;
        }

        expect(limited).toBe(true);
        expect(await host.post("/auth/login").send({ email: "user@example.com", password: "wrong-password" }))
            .toHaveProperty("status", 429);
    });
});