const transform = {
    "^.+\\.ts$": ["@swc/jest", { module: { type: "commonjs" } }],
};

const moduleNameMapper = {
    "^(\\.{1,2}/.*)\\.js$": "$1",
};

export default {
    displayName: "coverage",
    testEnvironment: "node",
    roots: ["<rootDir>/tests"],
    testMatch: ["<rootDir>/tests/**/*.test.ts"],
    transform,
    moduleNameMapper,
    setupFiles: ["<rootDir>/tests/setup/env.ts"],
    globalSetup: "<rootDir>/tests/setup/global-setup.ts",
    maxWorkers: 1,
    coverageProvider: "v8",
    coverageDirectory: "<rootDir>/coverage",
    coverageReporters: ["text-summary", "text", "lcov", "json-summary"],
    collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/data/**",
        "!src/index.ts",
        "!src/db/migrate.ts",
        "!src/db/seed.ts",
    ],
    coverageThreshold: {
        global: {
            statements: 88,
            branches: 73,
            functions: 86,
            lines: 88,
        },
    },
};
