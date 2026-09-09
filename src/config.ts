import "dotenv/config";

/**
 * Read env once, fail loudly at boot if something required is missing.
 *
 * Python analogue: this is the Pydantic Settings pattern. Validate at startup so a
 * missing var is a crash on line 1, not a `undefined` that surfaces 20 minutes later.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  mongoUrl: required("MONGO_URL"),
  // Not read until the pub/sub slice, so it stays optional for now.
  redisUrl: process.env.REDIS_URL,
} as const;
