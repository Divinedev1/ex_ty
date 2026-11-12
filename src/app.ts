import "dotenv/config";

import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import cors from "cors";

import { config } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { petRouter } from "./routes/pets.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { globalLimiter } from "./middleware/rateLimit.middleware.js";
import { requestLogger } from "./middleware/requestLog.middleware.js";
import { notFound } from "./http/errors.js";
import { startCache } from "./cache/client.js";
import { startMessaging } from "./messaging/index.js";

export const app: Express = express();

void startCache();
void startMessaging();

app.set("trust proxy", config.trustProxy);

app.use(requestLogger);
app.use(cors({ exposedHeaders: ["X-Request-ID"] }));
app.use(express.json({ limit: "100kb" }));

app.use("/health", healthRouter);

app.use(globalLimiter);

app.use("/auth", authRouter);
app.use("/pets", petRouter);

app.use((_req: Request, _res: Response, next: NextFunction): void => {
    next(notFound("No route found"));
});

app.use(errorHandler);