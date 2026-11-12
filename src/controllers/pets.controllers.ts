import type { Request, Response } from "express";

import type { PetParams, PetQueryParams } from "../http/types.js";
import { parsePagination } from "../http/pagination.js";
import type { Paginated } from "../http/pagination.js";
import { asBoolean, asInteger, asText } from "../http/validate.js";
import { notFound } from "../http/errors.js";
import { listPets, findPetById } from "../repositories/pets.repository.js";
import type { Pet } from "../data/pets.js";

export const getPets = async (
    req: Request<PetParams, Paginated<Pet>, Record<string, never>, PetQueryParams>,
    res: Response<Paginated<Pet>>
): Promise<void> => {
    const { species, adopted, limit, offset } = req.query;
    const pagination = parsePagination({ limit, offset });
    const speciesFilter = asText(species, "species", { maxLength: 64 });
    const adoptedFilter = asBoolean(adopted, "adopted");

    const { data, total, cache } = await listPets({
        ...(speciesFilter !== undefined ? { species: speciesFilter } : {}),
        ...(adoptedFilter !== undefined ? { adopted: adoptedFilter } : {}),
        ...pagination,
    });

    res.set("X-Cache", cache);
    res.json({
        data,
        meta: {
            total,
            limit: pagination.limit,
            offset: pagination.offset,
            hasMore: pagination.offset + data.length < total,
        },
    });
};

export const getPetById = async (
    req: Request<PetParams, Pet, Record<string, never>, PetQueryParams>,
    res: Response<Pet>
): Promise<void> => {
    const { pet, cache } = await findPetById(asInteger(req.params.id, "id", { min: 1 }));

    if (pet === undefined) {
        throw notFound("No pet with that ID");
    }

    res.set("X-Cache", cache);
    res.json(pet);
};