import express from "express";
import type { Router } from "express";

import { getPets, getPetById } from "../controllers/pets.controllers.js";
import { validateNumericId } from "../middleware/pets.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const petRouter: Router = express.Router();

petRouter.get("/", getPets);
petRouter.get("/:id", requireAuth, validateNumericId, getPetById);