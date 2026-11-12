import { config } from "../config/env.js";
import { logger } from "../logger.js";
import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";

export const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

pool.on("error", (err: Error): void => {
    logger.error("unexpected error on idle Postgres client", { err });
});

export const query = async <R extends QueryResultRow>(
    text: string,
    values: unknown[] = [],
): Promise<QueryResult<R>> => pool.query<R, unknown[]>(text, values);