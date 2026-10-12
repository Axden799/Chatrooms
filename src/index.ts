// WebSocket is imported as a value (not `type WebSocket`) so the readyState
// constants — WebSocket.OPEN, .CLOSED, .CONNECTING, .CLOSING — exist at runtime.
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { Types } from "mongoose";
import { config } from "./config.js";
import { connectToMongo, disconnectFromMongo } from "./db.js";
import { MessageModel } from "./models/Message.js";
import { ChatModel } from "./models/Chat.js";
import { connectToRedis, CHANNEL } from "./bus.js";

/**
 * SLICE 5 — instances reach each other's clients through Redis.
 *
 * The connections Map lives inside one process, so two instances could not deliver to
 * each other's clients: Alice on instance 1 was invisible to instance 2, and the
 * message was persisted and silently dropped.
 *
 * The fix MOVES delivery. The message handler no longer sends to anyone — it publishes
 * to a Redis channel. Every instance is subscribed, so every instance receives it and
 * delivers to whichever participants it happens to hold. No instance ever has to know
 * where a given user is connected.
 *
 * NOT in this slice: presence, offline delivery (the inbox), real users or tokens.
 */

/**
 * Pull `?userId=...` off the handshake. Returns null if absent or malformed.
 *
 * `req` is the HTTP GET that opened this connection — the one moment a URL and
 * headers exist. After the server answers 101 Switching Protocols there are only
 * frames, with nowhere to put metadata. So identity must be read here.
 *
 * The throwaway base URL is needed because `req.url` is a relative path
 * ("/?userId=abc") and the URL constructor requires an absolute one.
 */
function readUserId(req: IncomingMessage): Types.ObjectId | null {
  const url = new URL(req.url ?? "/", "http://placeholder");
  const raw = url.searchParams.get("userId");
  if (!raw || !Types.ObjectId.isValid(raw)) return null;
  return new Types.ObjectId(raw);
}

async function main(): Promise<void> {
  await connectToMongo();
  const bus = await connectToRedis();

  const wss = new WebSocketServer({ port: config.port });
  console.log(`[ws] listening on ws://localhost:${config.port}`);

  /**
   * Who is currently connected, as userId -> socket.
   *
   * Keys are strings, never ObjectId: Map compares keys with === (identity), and two
   * ObjectIds holding the same hex are different objects, so .get() would always miss.
   *
   * This Map lives inside one Node process. That is precisely why slice 5 needs a
   * Redis Pub/Sub backplane — a second instance has its own, separate Map and cannot
   * see the sockets held here.
   */
  const connections = new Map<string, WebSocket>();

  // Delivery lives HERE, not in the message handler. Redis runs this callback on
  // every instance for every published message — including the instance that
  // published it, which is how a sender still gets their own copy back.
  //
  // Each instance answers the same question against its OWN Map: do I hold any of
  // this chat's participants? Usually not, and the loop sends nothing. That is the
  // design — no instance has to know where anyone is connected.
  await bus.sub.subscribe(CHANNEL, async (raw) => {
    const saved = JSON.parse(raw)
    const chat = await ChatModel.findById(saved.chatId);
    if (!chat) {
      console.warn(`[bus] chat ${saved.chatId} not found — cannot deliver`);
      return;
    }
    for (const id of chat.participantIds) {
      const peer = connections.get(id.toString());
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify(saved));
      }
    }
  })

  wss.on("connection", (socket, req: IncomingMessage) => {
    const userId = readUserId(req);
    if (!userId) { 
      socket.close(1008, "a valid userId query parameter is required");
      return;
    }

    console.log(`[ws] connected: ${userId.toString()}`)

    connections.set(userId.toString(), socket);
    console.log(`Number of sockets: ${connections.size}`);

    socket.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        const chat = await ChatModel.findById(data.chatId);
        if (!chat) {
          console.warn("Could not find chat ID");
          return;
        }

        const isParticipant = chat.participantIds.some((i) => i.toString() === userId.toString());
        if (!isParticipant) {
          console.warn(`[ws] ${userId.toString()} is not in chat ${data.chatId} — ignored`);
          return;
        }

        const saved = await MessageModel.create({
          chatId: data.chatId,
          senderId: userId,
          body: data.body,
          serverTimestamp: new Date(),
        });

        // Publish instead of delivering. `connections` only holds sockets belonging
        // to THIS process, so a participant on another instance is invisible here.
        // Every instance is subscribed, so whichever one holds them delivers.
        await bus.pub.publish(CHANNEL, JSON.stringify(saved));
      } catch (err) {
        console.error("[ws] failed to handle message:", err);
      }
    });

    socket.on("close", () => {
      console.log("[ws] client disconnected");

      // Without this the Map only grows (a leak), and the loop above would try to
      // send into a dead socket instead of treating that user as offline.
      connections.delete(userId.toString());
    });

    socket.on("error", (err) => {
      console.error("[ws] socket error:", err);
    });
  });

  const shutdown = async (): Promise<void> => {
    console.log("\n[app] shutting down");
    wss.close();
    await bus.sub.quit();
    await bus.pub.quit();
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
