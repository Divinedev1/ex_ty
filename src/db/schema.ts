export const schemaSql = `
CREATE TABLE IF NOT EXISTS pets (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT        NOT NULL,
    species       TEXT        NOT NULL,
    breed         TEXT        NOT NULL,
    age           INTEGER     NOT NULL CHECK (age >= 0),
    adopted       BOOLEAN     NOT NULL DEFAULT FALSE,
    intake_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    adoption_date TIMESTAMPTZ,
    photo         TEXT        NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS medical_records (
    pet_id       INTEGER     PRIMARY KEY REFERENCES pets (id) ON DELETE CASCADE,
    vaccinations TEXT[]      NOT NULL DEFAULT '{}',
    weight_kg    NUMERIC(5,2) NOT NULL CHECK (weight_kg > 0),
    microchip_id TEXT        UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS audit_events (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id    UUID        NOT NULL UNIQUE,
    type        TEXT        NOT NULL,
    payload     JSONB       NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pets_species_idx ON pets (species);
CREATE INDEX IF NOT EXISTS pets_adopted_idx ON pets (adopted);
`;