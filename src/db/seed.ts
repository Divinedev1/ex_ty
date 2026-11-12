import "dotenv/config";

import { pool, query } from "./pool.js";
import { schemaSql } from "./schema.js";
import { hashPassword } from "../auth/password.js";
import { invalidatePetsCache } from "../cache/cache.js";
import { startCache, stopCache } from "../cache/client.js";
import { logger } from "../logger.js";

type SeedPet = {
    name: string,
    species: string,
    breed: string,
    age: number,
    adopted: boolean,
    intakeDate: string,
    adoptionDate: string | null,
    photo: string,
    vaccinations: string[],
    weightKg: number,
    microchipId: string | null,
}

const seedPets: SeedPet[] = [
    {
        name: "Luna", species: "dog", breed: "Border Collie", age: 3, adopted: false,
        intakeDate: "2026-01-14", adoptionDate: null,
        photo: "https://example.com/pets/luna.jpg",
        vaccinations: ["rabies", "dhpp"], weightKg: 18.5, microchipId: "MC-1001",
    },
    {
        name: "Milo", species: "cat", breed: "Domestic Shorthair", age: 5, adopted: true,
        intakeDate: "2025-11-02", adoptionDate: "2025-12-20",
        photo: "https://example.com/pets/milo.jpg",
        vaccinations: ["rabies", "felvax"], weightKg: 4.2, microchipId: "MC-1002",
    },
    {
        name: "Bella", species: "dog", breed: "Labrador Retriever", age: 7, adopted: false,
        intakeDate: "2026-02-08", adoptionDate: null,
        photo: "https://example.com/pets/bella.jpg",
        vaccinations: ["rabies"], weightKg: 31.75, microchipId: null,
    },
    {
        name: "Shadow", species: "cat", breed: "Maine Coon", age: 2, adopted: false,
        intakeDate: "2026-03-19", adoptionDate: null,
        photo: "https://example.com/pets/shadow.jpg",
        vaccinations: ["rabies", "felvax", "fvrcp"], weightKg: 6.9, microchipId: "MC-1004",
    },
    {
        name: "Rocky", species: "dog", breed: "German Shepherd", age: 4, adopted: true,
        intakeDate: "2025-08-11", adoptionDate: "2025-09-30",
        photo: "https://example.com/pets/rocky.jpg",
        vaccinations: ["rabies", "dhpp", "bordetella"], weightKg: 38.4, microchipId: "MC-1005",
    },
    {
        name: "Cleo", species: "rabbit", breed: "Holland Lop", age: 1, adopted: false,
        intakeDate: "2026-04-25", adoptionDate: null,
        photo: "https://example.com/pets/cleo.jpg",
        vaccinations: ["rabies"], weightKg: 1.6, microchipId: "MC-1006",
    },
];

const insertPet = async (pet: SeedPet): Promise<void> => {
    const { rows } = await query<{ id: number }>(
        `INSERT INTO pets (name, species, breed, age, adopted, intake_date, adoption_date, photo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
            pet.name, pet.species, pet.breed, pet.age, pet.adopted,
            pet.intakeDate, pet.adoptionDate, pet.photo,
        ],
    );

    const id: number | undefined = rows[0]?.id;
    if (id === undefined) {
        throw new Error(`Failed to insert pet ${pet.name}`);
    }

    await query(
        `INSERT INTO medical_records (pet_id, vaccinations, weight_kg, microchip_id)
         VALUES ($1, $2, $3, $4)`,
        [id, pet.vaccinations, pet.weightKg, pet.microchipId],
    );
};

type SeedUser = {
    email: string,
    password: string,
    role: string,
}

const seedUsers: SeedUser[] = [
    { email: "admin@example.com", password: "admin-password-123", role: "admin" },
    { email: "user@example.com", password: "user-password-123", role: "user" },
];

const insertUser = async (user: SeedUser): Promise<void> => {
    await query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)`,
        [user.email, await hashPassword(user.password), user.role],
    );
};

try {
    await query(schemaSql);
    await query("TRUNCATE pets RESTART IDENTITY CASCADE");
    await query("TRUNCATE users RESTART IDENTITY CASCADE");

    await startCache();
    await invalidatePetsCache();

    for (const pet of seedPets) {
        await insertPet(pet);
    }

    for (const user of seedUsers) {
        await insertUser(user);
    }

    const { rows } = await query<{ pets: string, users: string }>(
        `SELECT (SELECT COUNT(*) FROM pets)::text AS pets, (SELECT COUNT(*) FROM users)::text AS users`,
    );

    logger.info("seed complete", {
        pets: Number(rows[0]?.pets ?? 0),
        users: Number(rows[0]?.users ?? 0),
    });
} catch (err) {
    logger.error("seed failed", { err });
    process.exitCode = 1;
} finally {
    await stopCache();
    await pool.end();
}