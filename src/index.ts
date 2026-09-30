import { config } from "./config.js";
import { connectToMongo, disconnectFromMongo } from "./db.js";
import { createServer } from "./server.js";

/**
 * Production entry point. Reads config, connects Mongo, starts the server.
 *
 * Deliberately thin: everything interesting lives in server.ts so that tests can
 * import createServer() without this file's side effects (reading .env, binding a
 * fixed port, installing signal handlers).
 */
async function main(): Promise<void> {
  await connectToMongo();

  const server = await createServer({ port: config.port });
  console.log(`[ws] listening on ws://localhost:${server.port}`);

  const shutdown = async (): Promise<void> => {
    console.log("\n[app] shutting down");
    await server.close();
    await disconnectFromMongo();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[app] fatal:", err);
  process.exit(1);
});
