import { createClient } from "redis";
import { config } from "./config.js";

/**
 * The Redis connections that let server instances reach each other's clients.
 *
 * One channel for the whole app. A channel is just a name — it is NOT a chat. There
 * are many chats and exactly one channel.
 */
export const CHANNEL = "chat:messages";

/**
 * TWO connections, not one. Once a connection runs SUBSCRIBE, Redis puts it in
 * subscriber mode and it can no longer run other commands — publishing on it fails.
 * So: one to publish with, one to listen on. `.duplicate()` just opens a second
 * connection to the same Redis server.
 */
export async function connectToRedis() {
  const pub = createClient({ url: config.redisUrl });
  pub.on("error", (err) => console.error("[redis:pub] error:", err));
  await pub.connect();

  const sub = pub.duplicate();
  sub.on("error", (err) => console.error("[redis:sub] error:", err));
  await sub.connect();

  console.log("[redis] connected (pub + sub)");
  return { pub, sub };
}
