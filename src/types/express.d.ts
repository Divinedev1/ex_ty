import type { UserRole } from "../auth/jwt.js";

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: number,
                email: string,
                role: UserRole,
            };
        }
    }
}

export {};