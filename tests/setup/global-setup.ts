import { readFileSync } from "node:fs";

import { parse as parseDotenv } from "dotenv";
import { Pool, Client } from "pg";
import bcrypt from "bcryptjs";
import { createClient } from "redis";

const schemaSql = `
CREATE TABLE IF NOT EXISTS pets (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT        NOT NULL,
    species       TEXT        NOT NULL,
    breed         TEXT        NOT NULL,
    age           INTEGER     NOT NULL CHECK (age >= 0),
    adopted       BOOLEAN     NOT NULL DEFAULT FALSE,
    intake_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    adoption_date TIMESTAMPTZ,
    photo         TEXT        NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS medical_records (
    pet_id       INTEGER     PRIMARY KEY REFERENCES pets (id) ON DELETE CASCADE,
    vaccinations TEXT[]      NOT NULL DEFAULT '{}',
    weight_kg    NUMERIC(5,2) NOT NULL CHECK (weight_kg > 0),
    microchip_id TEXT        UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS audit_events (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id    UUID        NOT NULL UNIQUE,
    type        TEXT        NOT NULL,
    payload     JSONB       NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const fileEnv = ((): NodeJS.ProcessEnv => {
    try {
        return parseDotenv(readFileSync(".env"));
    } catch {
        return {};
    }
})();

const readEnv = (name: string): string | undefined => process.env[name] ?? fileEnv[name];

const baseUrl = readEnv("DATABASE_URL") ?? "postgres://pets:pets@localhost:5432/pets";
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";
const testDbName = "pets_test";

const withDb = (url: string, db: string): string => {
    const i = url.lastIndexOf("/");

    return `${url.slice(0, i + 1)}${db}`;
};

const testUrl = process.env.TEST_DATABASE_URL ?? withDb(baseUrl, testDbName);

const createTestDatabase = async (): Promise<void> => {
    const admin = new Client({ connectionString: baseUrl });
    await admin.connect();

    try {
        await admin.query(`CREATE DATABASE ${testDbName}`);
    } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "42P04") {
            throw err;
        }
    } finally {
        await admin.end();
    }
};

const seed = async (): Promise<void> => {
    const pool = new Pool({ connectionString: testUrl });
    await pool.query(schemaSql);
    await pool.query("TRUNCATE pets RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE audit_events RESTART IDENTITY CASCADE");

    const pets: {
        name: string,
        species: string,
        breed: string,
        age: number,
        adopted: boolean,
        intake: string,
        adoption: string | null,
        vaccinations: string[],
        weightKg: number,
        microchipId: string | null,
    }[] = [
        {
            name: "Luna", species: "dog", breed: "Border Collie", age: 3, adopted: false,
            intake: "2026-01-14", adoption: null,
            vaccinations: ["rabies", "dhpp"], weightKg: 18.5, microchipId: "MC-1001",
        },
        {
            name: "Milo", species: "cat", breed: "Domestic Shorthair", age: 5, adopted: true,
            intake: "2025-11-02", adoption: "2025-12-20",
            vaccinations: ["rabies", "felvax"], weightKg: 4.2, microchipId: "MC-1002",
        },
        {
            name: "Bella", species: "dog", breed: "Labrador Retriever", age: 7, adopted: false,
            intake: "2026-02-08", adoption: null,
            vaccinations: ["rabies"], weightKg: 31.75, microchipId: null,
        },
    ];

    for (const pet of pets) {
        const { rows } = await pool.query<{ id: number }>(
            `INSERT INTO pets (name, species, breed, age, adopted, intake_date, adoption_date, photo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, '')
             RETURNING id`,
            [pet.name, pet.species, pet.breed, pet.age, pet.adopted, pet.intake, pet.adoption],
        );
        await pool.query(
            `INSERT INTO medical_records (pet_id, vaccinations, weight_kg, microchip_id)
             VALUES ($1, $2, $3, $4)`,
            [rows[0]?.id, pet.vaccinations, pet.weightKg, pet.microchipId],
        );
    }

    const users: [string, string, string][] = [
        ["admin@example.com", "admin-password-123", "admin"],
        ["user@example.com", "user-password-123", "user"],
    ];

    for (const [email, password, role] of users) {
        await pool.query(
            `INSERT INTO users (email, password_hash, role)
             VALUES ($1, $2, $3)`,
            [email, await bcrypt.hash(password, 4), role],
        );
    }

    await pool.end();
};

const flushTestRedis = async (): Promise<void> => {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    await redis.flushDb();
    await redis.quit();
};

export default async function globalSetup(): Promise<void> {
    await createTestDatabase();
    await seed();
    await flushTestRedis();
};