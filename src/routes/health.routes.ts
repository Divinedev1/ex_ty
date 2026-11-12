import express from "express";
import type { Router } from "express";

import { getLiveness, getReadiness } from "../controllers/health.controllers.js";

export const healthRouter: Router = express.Router();

healthRouter.get("/live", getLiveness);
healthRouter.get("/ready", getReadiness);