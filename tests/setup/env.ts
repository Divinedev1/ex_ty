process.env.NODE_ENV = "test";
process.env.LOG_LEVEL ??= "silent";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    ?? "postgres://pets:pets@localhost:5432/pets_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.CACHE_ENABLED ??= "true";
process.env.RABBITMQ_URL ??= "amqp://localhost:5672";
process.env.BROKER_ENABLED ??= "false";
process.env.RATE_LIMIT_MAX ??= "10000";
process.env.LOGIN_RATE_LIMIT_MAX ??= "5";
process.env.BCRYPT_ROUNDS ??= "4";
process.env.JWT_SECRET ??= "test-only-secret-for-jest-suite-000000000000";