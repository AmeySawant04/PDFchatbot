/**
 * Jest Global Teardown
 *
 * Stops the in-memory MongoDB instance after all test suites finish.
 */

module.exports = async function globalTeardown() {
  if (globalThis.__MONGOD__) {
    await globalThis.__MONGOD__.stop();
    console.log("\n[Test Teardown] MongoMemoryServer stopped");
  }
};
