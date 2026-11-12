import { query } from "../db/pool.js";
import type { UserRole } from "../auth/jwt.js";

export type User = {
    id: number,
    email: string,
    passwordHash: string,
    role: UserRole,
    createdAt: Date,
}

type UserRow = {
    id: number,
    email: string,
    password_hash: string,
    role: string,
    created_at: Date,
};

const toUser = (row: UserRow): User => ({
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    createdAt: row.created_at,
});

export const findUserByEmail = async (email: string): Promise<User | undefined> => {
    const { rows } = await query<UserRow>(
        `SELECT id, email, password_hash, role, created_at
         FROM users
         WHERE LOWER(email) = LOWER($1)`,
        [email],
    );

    return rows[0] === undefined ? undefined : toUser(rows[0]);
};

export const findUserById = async (id: number): Promise<User | undefined> => {
    const { rows } = await query<UserRow>(
        `SELECT id, email, password_hash, role, created_at
         FROM users
         WHERE id = $1`,
        [id],
    );

    return rows[0] === undefined ? undefined : toUser(rows[0]);
};