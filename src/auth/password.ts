import bcrypt from "bcryptjs";

import { config } from "../config/env.js";

export const hashPassword = async (plain: string): Promise<string> =>
    bcrypt.hash(plain, config.bcryptRounds);

export const verifyPassword = async (plain: string, hash: string): Promise<boolean> =>
    bcrypt.compare(plain, hash);