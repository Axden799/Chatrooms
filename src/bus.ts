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
 * What travels over the channel.
 *
 * `participantIds` rides along so a receiving instance does NOT have to re-query Mongo
 * for the chat. The publishing instance already ran that query to authorize the sender;
 * without this, every instance would redo the same lookup for every message, putting a
 * database round-trip on the delivery path. It also pins the recipient list down at
 * publish time, so instances cannot disagree about who a message was for.
 *
 * They are `string[]`, not ObjectId[]: JSON has only six types — string, number,
 * boolean, null, object, array — and ObjectId is not one of them. So they cross the
 * wire as text and arrive as text, which is exactly what the connections Map is keyed on.
 *
 * `message` is `unknown` rather than `any` deliberately. It is pure cargo: this process
 * stringifies it and sends it on, never reading a field off it. `unknown` says so and
 * forces a narrowing step if that ever changes. `any` would silently permit typos.
 */
export interface BusMessage {
  participantIds: string[];

  /**
   * The message's own _id, carried separately so a subscriber can tear up the right
   * inbox note without reading fields off `message` — which is `unknown` on purpose.
   */
  messageId: string;

  message: unknown;
}

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

/**
 * Everything connectToRedis hands back, as one named type.
 *
 * Read it inside-out: `typeof connectToRedis` is the function's type; `ReturnType<>`
 * extracts what it returns (a Promise); `Awaited<>` unwraps the Promise. So Bus means
 * "whatever you get when you await connectToRedis()".
 *
 * Derived rather than written out by hand because createClient() and .duplicate()
 * return different generic instantiations in redis v6 — hand-writing either shape means
 * guessing at the library's internals, and getting it wrong is a compile error.
 */
export type Bus = Awaited<ReturnType<typeof connectToRedis>>;

export async function disconnectFromRedis(bus: Bus): Promise<void> {
  await bus.sub.quit();
  await bus.pub.quit();
  console.log("[redis] disconnected");
}
