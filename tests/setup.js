/**
 * Jest Global Setup
 *
 * Starts an in-memory MongoDB instance before all test suites run.
 * The connection URI is passed to tests via an environment variable.
 */

const { MongoMemoryServer } = require("mongodb-memory-server");

module.exports = async function globalSetup() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  // Store reference so globalTeardown can stop it
  globalThis.__MONGOD__ = mongod;

  // Set env vars for the test process
  process.env.MONGODB_URI = uri;
  process.env.JWT_SECRET = "test-jwt-secret-key-for-testing";
  process.env.SESSION_SECRET = "test-session-secret-key-for-testing";
  process.env.NODE_ENV = "test";
  process.env.PYTHON_API_URL = "http://localhost:5099"; // fake — mocked in tests

  console.log(`\n[Test Setup] MongoMemoryServer started at ${uri}`);
};
