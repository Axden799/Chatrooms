import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import { Types } from "mongoose";
import { config } from "./config.js";
import { connectToMongo, disconnectFromMongo } from "./db.js";
import { MessageModel } from "./models/Message.js";

/**
 * SLICE 2 — identity comes from the connection, not the message body.
 *
 * Slice 1 trusted `senderId` from the payload, so any client could claim to be
 * anyone. Now the server reads the user's id off the WebSocket handshake and uses
 * that instead, ignoring whatever the client asserts.
 *
 * NOT in this slice: routing to other users, a Chat model, presence, pub/sub.
 * Messages still echo only back to the sender.
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

  // ---- EDIT 1 -------------------------------------------------------------
  // Add a second parameter, `req`, to this handler. `ws` has always passed it;
  // slice 1 just ignored it. Type it as IncomingMessage:
  //
  //     wss.on("connection", (socket, req: IncomingMessage) => {
  // -------------------------------------------------------------------------
  wss.on("connection", (socket, req: IncomingMessage) => {
    // ---- EDIT 2 -----------------------------------------------------------
    // Read the identity, and refuse the connection if there isn't one.
    //
    //   1. const userId = readUserId(req);
    //   2. if (!userId) { close the socket and return }
    //
    // For step 2, close with code 1008 (Policy Violation) and a reason string —
    // same two-argument shape as any other close:
    //     socket.close(1008, "a valid userId query parameter is required");
    // The bare `return` matters: without it the handler keeps going and
    // registers handlers on a socket that is already closing.
    //
    // Then log who arrived, so you can see it working:
    //     console.log(`[ws] connected: ${userId.toString()}`);
    //
    // YOUR CODE:

    const userId = readUserId(req);
    if (!userId) { 
      socket.close(1008, "a valid userId query parameter is required");
      return;
    }

    console.log(`[ws] connected: ${userId.toString()}`)

    // -----------------------------------------------------------------------

    socket.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        // ---- EDIT 3 ---------------------------------------------------
        // Change senderId below from `data.senderId` to `userId`.
        //
        // One line, and it is the whole point of the slice: the sender is
        // now whoever owns this connection, not whoever the payload claims.
        // ---------------------------------------------------------------
        const saved = await MessageModel.create({
          chatId: data.chatId,
          senderId: userId,
          body: data.body,
          serverTimestamp: new Date(),
        });

        socket.send(JSON.stringify(saved));
      } catch (err) {
        console.error("[ws] failed to handle message:", err);
      }
    });

    socket.on("close", () => {
      console.log("[ws] client disconnected");
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
