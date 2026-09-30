import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach } from "vitest";

/**
 * Test database harness — the equivalent of conftest.py fixtures in pytest.
 *
 * mongodb-memory-server downloads a real mongod binary once (~100MB, cached in
 * node_modules/.cache) and runs it against an in-memory filesystem. So schema casting,
 * validation, and indexes all behave exactly like production Mongo, but the data is
 * disposable and completely isolated from your Docker containers.
 *
 * Direct parallel to TestingConfig's in-memory SQLite in api_project.
 */
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

// Wipe between tests so each one starts from a known-empty database and test order
// can never matter. Dropping collections rather than the database keeps the indexes
// Mongoose built at connect time.
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key]?.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
