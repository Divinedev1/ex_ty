const transform = {
    "^.+\\.ts$": ["@swc/jest", { module: { type: "commonjs" } }],
};

const moduleNameMapper = {
    "^(\\.{1,2}/.*)\\.js$": "$1",
};

export default {
    maxWorkers: 1,
    projects: [
        {
            displayName: "unit",
            testEnvironment: "node",
            roots: ["<rootDir>/tests"],
            testMatch: ["<rootDir>/tests/**/*.unit.test.ts"],
            transform,
            moduleNameMapper,
            setupFiles: ["<rootDir>/tests/setup/env.ts"],
        },
        {
            displayName: "integration",
            testEnvironment: "node",
            roots: ["<rootDir>/tests"],
            testMatch: ["<rootDir>/tests/**/*.integration.test.ts"],
            transform,
            moduleNameMapper,
            setupFiles: ["<rootDir>/tests/setup/env.ts"],
            globalSetup: "<rootDir>/tests/setup/global-setup.ts",
        },
    ],
};
