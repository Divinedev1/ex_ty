import "dotenv/config";

import { pool, query } from "./pool.js";
import { schemaSql } from "./schema.js";
import { logger } from "../logger.js";

try {
    await query(schemaSql);
    logger.info("schema up to date");
} catch (err) {
    logger.error("migration failed", { err });
    process.exitCode = 1;
} finally {
    await pool.end();
}