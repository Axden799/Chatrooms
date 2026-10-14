// WebSocket is imported as a value (not `type WebSocket`) so the readyState
// constants — WebSocket.OPEN, .CLOSED, .CONNECTING, .CLOSING — exist at runtime.
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Types } from "mongoose";
import { config } from "./config.js";
import { connectToMongo, disconnectFromMongo } from "./db.js";
import { MessageModel } from "./models/Message.js";
import { ChatModel } from "./models/Chat.js";
import { connectToRedis, disconnectFromRedis, CHANNEL, type BusMessage } from "./bus.js";

/**
 * SLICE 6 — one port serves both HTTP and WebSocket.
 *
 * Previously `new WebSocketServer({ port })` bound the port itself, so this process
 * could only speak WebSocket. Now an HTTP server owns the port and the WebSocket
 * server attaches to it. A request carrying `Upgrade: websocket` headers is handed to
 * `ws`; anything else goes to the HTTP handler.
 *
 * That works because a WebSocket connection BEGINS as an ordinary HTTP GET — the same
 * fact slice 2 relied on to read identity off the handshake.
 *
 * This exists so a later slice can add a login endpoint, which needs HTTP. Nothing
 * about authentication changes here.
 *
 * ---- previously (slice 5) ----
 * instances reach each other's clients through Redis.
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

  // An HTTP server owns the port. The WebSocket server attaches to it below, so one
  // port serves both protocols: a request carrying `Upgrade: websocket` is claimed by
  // `ws`, anything else lands in this handler. That works because a WebSocket
  // connection begins as an ordinary HTTP GET.
  //
  // /health exists because Railway and most platforms poll one to decide whether this
  // instance is alive and should receive traffic.
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // `server:` rather than `port:` — ws does not open a port, it watches this server.
  const wss = new WebSocketServer({ server: httpServer });

  // Something must still open the port, and now it is the HTTP server. The callback
  // fires once the port is actually bound, so the log cannot precede it.
  httpServer.listen(config.port, () => {
    console.log(`[http+ws] listening on port ${config.port}`);
  });

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
  await bus.sub.subscribe(CHANNEL, (raw) => {
    // `as BusMessage` is a type ASSERTION, not a check — nothing verifies it at
    // runtime. That is acceptable only because we wrote the producer: our own publish
    // above created this, in a shape we control, over a Redis only our servers reach.
    // Contrast JSON.parse(raw.toString()) in the message handler below, which is
    // deliberately NOT cast because it comes from a browser. Cast what you produced;
    // validate what you did not.
    const { participantIds, message } = JSON.parse(raw) as BusMessage;

    // No Mongo lookup: the recipient list arrived with the message. And no .toString()
    // on `id` — these came through JSON, which has no ObjectId type, so they are
    // already text.
    for (const id of participantIds) {
      const peer = connections.get(id);
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify(message));
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
        //
        // The recipient list travels WITH the message. .map runs toString() on each
        // ObjectId and returns a new array of text ids — Python's [str(i) for i in ids].
        // Sending them means no receiving instance has to re-query this chat.
        const payload: BusMessage = {
          participantIds: chat.participantIds.map((i) => i.toString()),
          message: saved,
        };
        await bus.pub.publish(CHANNEL, JSON.stringify(payload));
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
    httpServer.close();
    await disconnectFromRedis(bus);
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
