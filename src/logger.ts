import { config } from "./config/env.js";
import type { LogLevel } from "./config/env.js";

type LogContext = Record<string, unknown>;

const SEVERITY: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    silent: -1,
};

const normalize = (value: unknown): unknown =>
    value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value;

export const formatLogEntry = (level: LogLevel, msg: string, context?: LogContext): string => {
    const entry: Record<string, unknown> = {
        level,
        time: new Date().toISOString(),
        msg,
    };

    if (context !== undefined) {
        for (const [key, value] of Object.entries(context)) {
            entry[key] = normalize(value);
        }
    }

    try {
        return JSON.stringify(entry);
    } catch {
        return JSON.stringify({ level, time: entry.time, msg, context: "unserializable" });
    }
};

const write = (level: LogLevel, msg: string, context?: LogContext): void => {
    if (SEVERITY[level] > SEVERITY[config.logLevel]) return;

    const line = `${formatLogEntry(level, msg, context)}\n`;

    if (level === "error" || level === "warn") {
        process.stderr.write(line);
    } else {
        process.stdout.write(line);
    }
};

export const logger = {
    error: (msg: string, context?: LogContext): void => write("error", msg, context),
    warn: (msg: string, context?: LogContext): void => write("warn", msg, context),
    info: (msg: string, context?: LogContext): void => write("info", msg, context),
    debug: (msg: string, context?: LogContext): void => write("debug", msg, context),
};
