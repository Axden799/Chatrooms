import { WebSocketServer, WebSocket } from "ws";
import express, { type Request, type Response } from "express";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { Types } from "mongoose";
import { config } from "./config.js";
import { connectToMongo, disconnectFromMongo } from "./db.js";
import { MessageModel } from "./models/Message.js";
import { ChatModel } from "./models/Chat.js";
import { UserModel } from "./models/User.js";
import { InboxModel } from "./models/Inbox.js";
import bcrypt from "bcrypt";
import { MongoServerError } from "mongodb";
import jwt from "jsonwebtoken";
import { connectToRedis, disconnectFromRedis, CHANNEL, type BusMessage } from "./bus.js";

/**
 * Chatrooms server. One port serves Express (HTTP) and `ws` (WebSocket) — a request
 * with `Upgrade: websocket` goes to ws, anything else to Express.
 *
 * Message flow: client sends -> verify sender is a chat participant -> persist with a
 * server timestamp -> publish to Redis. Every instance subscribes and delivers to the
 * participants it holds in its own Map, so no instance needs to know where a user is.
 *
 * See DESIGN.md for scope and the deferred list; git log for why each piece exists.
 */

/**
 * Verify `?token=` and return the user id it proves, or null to refuse the connection.
 *
 * The token is in the query string because a browser's WebSocket API cannot set
 * headers. jwt.verify throws (bad signature, wrong secret, not a JWT, expired), hence
 * the try/catch; the client is not told which, since that is useful to an attacker.
 * verify returns `string | JwtPayload`, so the union is narrowed before reading .sub.
 */
function userIdFromToken(req: IncomingMessage): Types.ObjectId | null {
  const url = new URL(req.url ?? "/", "http://placeholder");
  const token = url.searchParams.get("token");
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (typeof payload === "string") return null;
    const sub = payload.sub;
    if (!sub || !Types.ObjectId.isValid(sub)) return null;
    return new Types.ObjectId(sub);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await connectToMongo();
  const bus = await connectToRedis();

  // express.json() is middleware that parses request bodies into req.body.
  const app = express();
  app.use(express.json());

  // Railway and similar platforms poll a health endpoint to decide if this instance
  // should receive traffic.
  app.get("/health", (req: Request, res: Response) => {
    res.json({ok: true});
  });

  // req.body is `any` and a client produced it, so it is checked rather than cast.
  // Password length is checked here because the schema only sees the ~60-char hash.
  // The findOne is a nicer error in the common case; the 11000 handler is the real
  // guarantee, since two simultaneous registrations both see an empty result.
  app.post("/register", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password must be strings" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters"});
      return;
    }
    const existing = await UserModel.findOne({ username });
    if (existing) {
      res.status(409).json({ error: "username already taken" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    try {
      const user = await UserModel.create({ username, passwordHash });
      res.status(201).json({ id: user._id, username: user.username });
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        res.status(409).json({ error: "username already taken" });
        return;
      }
      console.error("[register] failed:", err);
      res.status(500).json({ error: "could not create user" });
    }
  });

  // The 401 is identical for "no such user" and "wrong password" so the endpoint
  // cannot be used to discover which usernames exist. The token's payload is readable
  // by anyone holding it — the signature is what makes it trustworthy, and the server
  // keeps no copy, which is why any instance can verify it.
  app.post("/login", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password must be strings" });
      return;
    }
    const user = await UserModel.findOne({ username });
    const ok = user ? await bcrypt.compare(password, user.passwordHash): false;
    if (!user || !ok) {
      res.status(401).json({ error: "invalid username or password" });
      return;
    }
    const token = jwt.sign(
      { sub: user._id.toString() },
      config.jwtSecret,
      { expiresIn: "7d" }
    );
    res.json({ token });
  });

  // `server:` rather than `port:` — ws attaches to the HTTP server instead of binding
  // its own port, so both protocols share one.
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  httpServer.listen(config.port, () => {
    console.log(`[http+ws] listening on port ${config.port}`);
  });

  // Keys are strings: Map compares with ===, and two ObjectIds of the same hex are
  // different objects. This Map is per-process, which is why Redis exists below.
  const connections = new Map<string, WebSocket>();

  // Delivery lives here, not in the message handler. Redis runs this on every
  // instance for every published message, including the publisher — which is how a
  // sender gets their own copy back through one code path.
  await bus.sub.subscribe(CHANNEL, async (raw) => {
    const { participantIds, messageId, message } = JSON.parse(raw) as BusMessage;
    for (const id of participantIds) {
      const peer = connections.get(id);
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify(message));

        // Delivered, so they are no longer owed it. BOTH fields: userId alone would
        // wipe notes for messages they have not received yet. Only the instance that
        // actually sent the bytes runs this, which is why notes are written for
        // everyone and deleted on delivery. See Inbox.ts.
        await InboxModel.deleteOne({ userId: id, messageId });
      }
    }
  })

  wss.on("connection", async (socket, req: IncomingMessage) => {
    const userId = userIdFromToken(req);
    if (!userId) { 
      socket.close(1008, "a valid token query parameter is required");
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

        // A note per participant, so anyone offline receives this on their next
        // connect. Awaited BEFORE the publish: delivery follows from publishing, and
        // a note written afterwards could be torn up before it existed.
        await InboxModel.insertMany(
          chat.participantIds.map((id) => ({ userId: id, messageId: saved._id }))
        )

        // participantIds rides along so no subscriber has to re-query the chat.
        const payload: BusMessage = {
          participantIds: chat.participantIds.map((i) => i.toString()),
          messageId: saved._id.toString(),
          message: saved,
        };
        await bus.pub.publish(CHANNEL, JSON.stringify(payload));
      } catch (err) {
        console.error("[ws] failed to handle message:", err);
      }
    });

    socket.on("close", () => {
      console.log("[ws] client disconnected");
      // Without this the Map leaks and delivery would target a dead socket.
      connections.delete(userId.toString());
    });

    socket.on("error", (err) => {
      console.error("[ws] socket error:", err);
    });

    // Flush what this user missed while offline. This must come AFTER the handler
    // registrations above: the early `return` below exits this function, and if it
    // ran first it would skip registering them — leaving a connected socket that
    // silently ignores every message.
    try {
      const notes = await InboxModel.find({ userId });
      if (notes.length === 0) return;
      const missed = await MessageModel.find({
        _id: { $in: notes.map((n) => n.messageId) },
      }).sort({ serverTimestamp: 1});
      for (const m of missed) socket.send(JSON.stringify(m));
      await InboxModel.deleteMany({ userId });
    } catch (err) {
      console.error("error handling inbox messages: ", err);
    }

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
