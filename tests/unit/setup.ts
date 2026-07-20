// Unit tests never talk to real infrastructure, but modules validate their
// environment at import time — provide a complete, obviously-fake config.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5433/test";
process.env.SESSION_SECRET ??= "unit-test-secret-0123456789abcdef0123456789";
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ENDPOINT_URL ??= "http://localhost:4566";
process.env.S3_BUCKET ??= "test-bucket";
process.env.JOBS_QUEUE_URL ??= "http://localhost:4566/000000000000/test-queue";
process.env.AI_PROVIDER ??= "mock";
