import { asInteger } from "./validate.js";

export const DEFAULT_LIMIT = 15;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;

export type Pagination = {
    limit: number,
    offset: number,
}

export type Paginated<T> = {
    data: T[],
    meta: {
        total: number,
        limit: number,
        offset: number,
        hasMore: boolean,
    },
}

export const parsePagination = (query: {
    limit?: string | string[],
    offset?: string | string[],
}): Pagination => ({
    limit: asInteger(query.limit, "limit", {
        min: MIN_LIMIT,
        max: MAX_LIMIT,
        fallback: DEFAULT_LIMIT,
    }),
    offset: asInteger(query.offset, "offset", { min: 0, fallback: 0 }),
});