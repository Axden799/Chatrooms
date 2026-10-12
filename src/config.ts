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
  // Required as of the pub/sub slice — instances cannot reach each other without it.
  redisUrl: required("REDIS_URL"),
} as const;
