import type { Request, Response, NextFunction } from "express";

import { asInteger } from "../http/validate.js";
import type { PetParams, PetQueryParams } from "../http/types.js";

export const validateNumericId = (
    req: Request<PetParams, unknown, Record<string, never>, PetQueryParams>,
    _res: Response,
    next: NextFunction
): void => {
    try {
        asInteger(req.params.id, "id", { min: 1 });
        next();
    } catch (err) {
        next(err);
    }
};