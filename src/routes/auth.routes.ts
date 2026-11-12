import express from "express";
import type { Router } from "express";

import { login, me } from "../controllers/auth.controllers.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { loginLimiter } from "../middleware/rateLimit.middleware.js";

export const authRouter: Router = express.Router();

authRouter.post("/login", loginLimiter, login);
authRouter.get("/me", requireAuth, me);