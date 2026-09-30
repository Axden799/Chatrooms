import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not a browser DOM.
    environment: "node",
    // Runs once before every test FILE — starts in-memory Mongo, wipes between tests.
    // Closest analogue to conftest.py.
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Integration tests boot real servers and open real sockets; the 5s default is tight
    // on the first run, when mongodb-memory-server may still be downloading its binary.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
