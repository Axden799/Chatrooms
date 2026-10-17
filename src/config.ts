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

  /**
   * Signs and verifies login tokens. `required()` rather than a default on purpose: a
   * fallback value would silently ship to production, and anyone who knew it could mint
   * a valid token for any user. Better to refuse to boot.
   */
  jwtSecret: required("JWT_SECRET"),

  /**
   * Which browser origins may call this API. Comma-separated.
   *
   * A browser refuses to let page A read a response from server B unless B says it is
   * allowed — so without this, the Vite dev server on :5173 cannot reach :8080 at all.
   * An allowlist rather than `*` because these requests carry a bearer token.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
