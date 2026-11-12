import { query } from "../db/pool.js";
import { config } from "../config/env.js";
import type { Pagination } from "../http/pagination.js";
import type { Pet, PetRow } from "../data/pets.js";
import {
    buildPetsIdKey,
    buildPetsListKey,
    cacheRead,
    cacheWrite,
    isCacheActive,
} from "../cache/cache.js";
import type { CacheStatus } from "../cache/cache.js";

export type ListPetsParams = Pagination & {
    species?: string,
    adopted?: boolean,
}

export type ListPetsResult = {
    data: Pet[],
    total: number,
    cache: CacheStatus,
}

export type FindPetResult = {
    pet?: Pet,
    cache: CacheStatus,
}

const toPet = (row: PetRow): Pet => ({
    id: row.id,
    name: row.name,
    species: row.species,
    breed: row.breed,
    age: row.age,
    adopted: row.adopted,
    intakeDate: row.intake_date,
    ...(row.adoption_date ? { adoptionDate: row.adoption_date } : {}),
    medicalRecords: {
        vaccinations: row.vaccinations ?? [],
        weightKg: row.weight_kg === null ? 0 : Number(row.weight_kg),
        microchipId: row.microchip_id,
    },
    photo: row.photo,
});

const revivePet = (raw: Pet): Pet => ({
    ...raw,
    intakeDate: new Date(raw.intakeDate),
    ...(raw.adoptionDate !== undefined
        ? { adoptionDate: new Date(raw.adoptionDate) }
        : {}),
});

const revivePets = (raw: Pet[]): Pet[] => raw.map(revivePet);

const buildFilters = (params: ListPetsParams): { sql: string, values: unknown[] } => {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (params.species !== undefined) {
        values.push(params.species.toLowerCase());
        clauses.push(`LOWER(p.species) = $${values.length}`);
    }

    if (params.adopted !== undefined) {
        values.push(params.adopted);
        clauses.push(`p.adopted = $${values.length}`);
    }

    return {
        sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
        values,
    };
};

export const listPets = async (params: ListPetsParams): Promise<ListPetsResult> => {
    const key = await buildPetsListKey({
        limit: params.limit,
        offset: params.offset,
        species: params.species?.toLowerCase(),
        adopted: params.adopted,
    });

    const cached = await cacheRead<{ data: Pet[], total: number }>(key);

    if (cached !== undefined) {
        return { data: revivePets(cached.data), total: cached.total, cache: "HIT" };
    }

    const active = isCacheActive();

    const { sql: whereSql, values: filterValues } = buildFilters(params);
    const values = [...filterValues, params.limit, params.offset];

    const { rows } = await query<PetRow>(
        `WITH filtered AS (
             SELECT p.*, m.vaccinations, m.weight_kg, m.microchip_id
             FROM pets p
             LEFT JOIN medical_records m ON m.pet_id = p.id
             ${whereSql}
         )
         SELECT filtered.*, (SELECT COUNT(*) FROM filtered) AS total_count
         FROM filtered
         ORDER BY filtered.id
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
    );

    const total = rows.length > 0 ? Number(rows[0].total_count) : await countPets(whereSql, filterValues);
    const data = rows.map(toPet);

    await cacheWrite(key, { data, total }, config.cache.ttlPetsList);

    return { data, total, cache: active ? "MISS" : "SKIP" };
};

const countPets = async (whereSql: string, values: unknown[]): Promise<number> => {
    const { rows } = await query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM pets p
         ${whereSql}`,
        values,
    );

    return Number(rows[0]?.count ?? 0);
};

export const findPetById = async (id: number): Promise<FindPetResult> => {
    const key = await buildPetsIdKey(id);
    const cached = await cacheRead<Pet>(key);

    if (cached !== undefined) {
        return { pet: revivePet(cached), cache: "HIT" };
    }

    const active = isCacheActive();

    const { rows } = await query<PetRow>(
        `SELECT p.*, m.vaccinations, m.weight_kg, m.microchip_id
         FROM pets p
         LEFT JOIN medical_records m ON m.pet_id = p.id
         WHERE p.id = $1`,
        [id],
    );

    const pet = rows[0] === undefined ? undefined : toPet(rows[0]);

    if (pet !== undefined) {
        await cacheWrite(key, pet, config.cache.ttlPetById);
    }

    return { pet, cache: active ? "MISS" : "SKIP" };
};