import { badRequest } from "./errors.js";

type RawParam = string | string[] | undefined;

const rejectRepeated = (raw: RawParam, field: string): string | undefined => {
    if (Array.isArray(raw)) {
        throw badRequest(`${field} must be provided exactly once`, { field });
    }

    return raw;
};

export const asInteger = (
    raw: RawParam,
    field: string,
    options: { min?: number, max?: number, fallback?: number } = {},
): number => {
    const value = rejectRepeated(raw, field);

    if (value === undefined) {
        if (options.fallback === undefined) {
            throw badRequest(`${field} is required`, { field });
        }

        return options.fallback;
    }

    if (!/^-?\d+$/.test(value)) {
        throw badRequest(`${field} must be an integer`, { field, received: value });
    }

    const parsed = Number(value);

    if (options.min !== undefined && parsed < options.min) {
        throw badRequest(`${field} must be greater than or equal to ${options.min}`, {
            field,
            received: value,
        });
    }

    if (options.max !== undefined && parsed > options.max) {
        throw badRequest(`${field} must be less than or equal to ${options.max}`, {
            field,
            received: value,
        });
    }

    return parsed;
};

export const asBoolean = (raw: RawParam, field: string): boolean | undefined => {
    const value = rejectRepeated(raw, field);

    if (value === undefined) return undefined;

    if (value === "true") return true;
    if (value === "false") return false;

    throw badRequest(`${field} must be either true or false`, { field, received: value });
};

export const asText = (
    raw: RawParam,
    field: string,
    options: { maxLength?: number } = {},
): string | undefined => {
    const value = rejectRepeated(raw, field);

    if (value === undefined) return undefined;

    if (value.length === 0) {
        throw badRequest(`${field} must not be empty`, { field });
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
        throw badRequest(`${field} must be at most ${options.maxLength} characters`, {
            field,
            received: String(value.length),
        });
    }

    return value;
};