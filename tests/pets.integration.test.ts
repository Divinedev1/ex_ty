import request from "supertest";

import { app } from "../src/app.js";
import { startCache } from "../src/cache/client.js";
import { invalidatePetsCache, isCacheActive } from "../src/cache/cache.js";
import { stopCache } from "../src/cache/client.js";
import { stopBroker } from "../src/messaging/broker.js";
import { pool } from "../src/db/pool.js";

const host = request(app);

let loginToken = "";
let cacheOn = false;

const login = async (): Promise<string> => {
    const res = await host.post("/auth/login").send({ email: "user@example.com", password: "user-password-123" });

    return res.body.accessToken as string;
};

beforeAll(async () => {
    await startCache();
    cacheOn = isCacheActive();
    loginToken = await login();
});

afterAll(async () => {
    await stopBroker();
    await stopCache();
    await pool.end();
});

describe("GET /pets", () => {
    it("returns every pet in id order with a meta envelope", async () => {
        const res = await host.get("/pets").expect(200);

        expect(res.body.data).toHaveLength(3);
        expect(res.body.data.map((pet: { id: number }) => pet.id)).toEqual([1, 2, 3]);
        expect(res.body.meta).toEqual({ total: 3, limit: 15, offset: 0, hasMore: false });
        expect(res.headers["x-cache"]).toMatch(/^(HIT|MISS|SKIP)$/);
    });

    it("paginates with limit and offset", async () => {
        const res = await host.get("/pets?limit=1&offset=1").expect(200);

        expect(res.body.data.map((pet: { id: number }) => pet.id)).toEqual([2]);
        expect(res.body.meta).toEqual({ total: 3, limit: 1, offset: 1, hasMore: true });
    });

    it("flips hasMore off on the last page", async () => {
        const res = await host.get("/pets?limit=2&offset=2").expect(200);

        expect(res.body.data).toHaveLength(1);
        expect(res.body.meta.hasMore).toBe(false);
    });

    it("filters by species case-insensitively", async () => {
        const res = await host.get("/pets?species=DOG").expect(200);

        expect(res.body.data.map((pet: { name: string }) => pet.name)).toEqual(["Luna", "Bella"]);
        expect(res.body.meta.total).toBe(2);
    });

    it("filters by adopted", async () => {
        const res = await host.get("/pets?adopted=true").expect(200);

        expect(res.body.data.map((pet: { name: string }) => pet.name)).toEqual(["Milo"]);
        expect(res.body.meta.total).toBe(1);
    });

    it("combines species and adopted filters", async () => {
        const res = await host.get("/pets?species=dog&adopted=false").expect(200);

        expect(res.body.data.map((pet: { name: string }) => pet.name)).toEqual(["Luna", "Bella"]);
        expect(res.body.meta.total).toBe(2);
    });

    it.each([
        "limit=abc",
        "limit=0",
        "limit=101",
        "offset=-1",
        "adopted=banana",
        "species=",
        `species=${"x".repeat(65)}`,
        "limit=1&limit=2",
    ])("rejects %s with 400 VALIDATION_ERROR", async (query) => {
        const res = await host.get(`/pets?${query}`).expect(400);

        expect(res.body.code).toBe("VALIDATION_ERROR");
        expect(res.body.details.field).toBeDefined();
    });
});

describe("GET /pets caching", () => {
    it("during a read: MISS on first, HIT on second when the cache is active", async () => {
        const first = await host.get("/pets?limit=3").expect(200);
        const second = await host.get("/pets?limit=3").expect(200);

        if (cacheOn) {
            expect(first.headers["x-cache"]).toBe("MISS");
            expect(second.headers["x-cache"]).toBe("HIT");
        } else {
            expect(first.headers["x-cache"]).toBe("SKIP");
            expect(second.headers["x-cache"]).toBe("SKIP");
        }
    });

    it("a generation bump invalidates cached lists", async () => {
        if (!cacheOn) return;

        await host.get("/pets?limit=4").expect(200);
        await invalidatePetsCache();
        const res = await host.get("/pets?limit=4").expect(200);

        expect(res.headers["x-cache"]).toBe("MISS");
    });
});

describe("GET /pets/:id", () => {
    it("requires a bearer token", async () => {
        const res = await host.get("/pets/1");

        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
    });

    it("returns a pet with its nested medical record", async () => {
        const res = await host.get("/pets/1").set("Authorization", `Bearer ${loginToken}`).expect(200);

        expect(res.body.id).toBe(1);
        expect(res.body.name).toBe("Luna");
        expect(res.body.species).toBe("dog");
        expect(res.body.adopted).toBe(false);
        expect(!Number.isNaN(Date.parse(res.body.intakeDate))).toBe(true);
        expect(res.body.medicalRecords).toEqual({
            vaccinations: ["rabies", "dhpp"],
            weightKg: 18.5,
            microchipId: "MC-1001",
        });
    });

    it("includes adoptionDate for adopted pets", async () => {
        const res = await host.get("/pets/2").set("Authorization", `Bearer ${loginToken}`).expect(200);

        expect(res.body.adopted).toBe(true);
        expect(!Number.isNaN(Date.parse(res.body.adoptionDate))).toBe(true);
    });

    it("returns 404 for a missing pet", async () => {
        const res = await host.get("/pets/999").set("Authorization", `Bearer ${loginToken}`);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({
            status: 404,
            code: "NOT_FOUND",
            message: "No pet with that ID",
        });
    });

    it("returns 400 for a non-integer id", async () => {
        const res = await host.get("/pets/abc").set("Authorization", `Bearer ${loginToken}`);

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
        expect(res.body.details.field).toBe("id");
    });

    it("returns 400 for an out-of-range id", async () => {
        await host.get("/pets/0").set("Authorization", `Bearer ${loginToken}`).expect(400);
    });
});