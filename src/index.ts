// WebSocket is imported as a value (not `type WebSocket`) so the readyState
// constants — WebSocket.OPEN, .CLOSED, .CONNECTING, .CLOSING — exist at runtime.
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { Types } from "mongoose";
import { config } from "./config.js";
import { connectToMongo, disconnectFromMongo } from "./db.js";
import { MessageModel } from "./models/Message.js";
import { ChatModel } from "./models/Chat.js";

/**
 * SLICE 4 — conversations have members, and membership gates both directions.
 *
 * `chatId` finally means something. A message is only accepted from a participant of
 * that chat, and is only delivered to its participants. Both come from one lookup.
 *
 * Note the delivery loop no longer iterates the whole registry. It iterates the chat's
 * participants and looks each one up by id — which is exactly why the registry is a
 * Map keyed on userId rather than the Set that `ws` already exposes as wss.clients.
 *
 * NOT in this slice: presence, pub/sub, offline delivery, real users or tokens.
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

        // Deliver to the chat's participants, looking each socket up by user id —
        // the lookup that justified a Map over the Set in wss.clients. `peer &&` is
        // required because a participant may simply not be connected.
        //
        // An offline participant gets nothing and will NOT receive it on reconnect.
        // That gap is what the inbox slice fixes.
        for (const id of chat.participantIds) {
          const peer = connections.get(id.toString());
          if (peer && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify(saved));
          }
        }
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
