// WebSocket is imported as a value (not `type WebSocket`) so the readyState
// constants — WebSocket.OPEN, .CLOSED, .CONNECTING, .CLOSING — exist at runtime.
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
import bcrypt from "bcrypt";
import { MongoServerError } from "mongodb";
import jwt from "jsonwebtoken";
import { connectToRedis, disconnectFromRedis, CHANNEL, type BusMessage } from "./bus.js";

/**
 * Chatrooms server — WebSocket chat with a Redis backplane.
 *
 * One port serves both protocols: an Express app handles HTTP, and the WebSocket
 * server attaches to the same HTTP server. A request carrying `Upgrade: websocket` is
 * claimed by `ws`; anything else goes to Express. That works because a WebSocket
 * connection begins as an ordinary HTTP GET.
 *
 * Message flow: a client sends over its socket -> the server checks the sender is a
 * participant of that chat -> persists with a server timestamp -> PUBLISHES to Redis.
 * Every instance is subscribed, and each delivers to whichever participants it holds in
 * its own `connections` Map. No instance has to know where a user is connected.
 *
 * NOT YET: real users or tokens (anyone can claim any userId — see DESIGN.md deferred
 * items 1-2), offline delivery (the inbox), presence, groups.
 *
 * Slice history is in git log; DESIGN.md holds scope and the deferred list.
 */

/**
 * Verify the `?token=...` on the handshake and return the user id it proves.
 * Returns null for any failure, and the caller refuses the connection.
 *
 * Renamed from readUserId: the old name described trusting a claim. This one
 * VERIFIES. Until now a client sent `?userId=` and the server believed it, so
 * anyone who knew a userId could be that user — and userIds are not secret, they
 * appear in every message's senderId.
 *
 * Still read off `req`, the HTTP GET that opened this connection, because that is
 * the one moment a URL exists. After the 101 response there are only frames.
 *
 * Why the token is in the query string rather than an Authorization header: the
 * browser's WebSocket API cannot set custom headers. Cookies, the subprotocol
 * field, or the query string are the only options.
 */
function userIdFromToken(req: IncomingMessage): Types.ObjectId | null {
  // jwt.verify THROWS rather than returning false — on a tampered signature, the
  // wrong secret, a string that is not a JWT, and on expiry — so the try/catch is
  // load-bearing. Every failure means the same thing: not authenticated. The client
  // is deliberately not told which failure it was; "expired" versus "forged" is
  // information an attacker can use.
  //
  // verify returns `string | JwtPayload`, because a JWT payload is allowed to be a
  // bare string. We always sign an object, so that branch never fires, but TS will
  // not let you read .sub off a union. `typeof` here is JavaScript's runtime
  // operator, not TypeScript's type-level one — it survives compilation and really
  // inspects the value, which is what lets TS narrow the type afterwards.
  //
  // `sub` is `string | undefined` because the JWT spec makes it optional, and it is
  // a STRING because JSON has no ObjectId type. isValid() only asks a question and
  // returns a boolean; `new Types.ObjectId()` is what actually builds the object,
  // and it throws on garbage — hence guard, then convert.
  //
  // The signature proves WE issued this token. It does not prove the user still
  // exists: an account could be deleted while a valid token is held. Catching that
  // needs a Mongo lookup per handshake. Out of scope; the gap is real.
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

  // Express handles the HTTP side: routing by method + path, and body parsing.
  // app.use() installs middleware — a function that runs on every request before any
  // route. express.json() is the one that reads the request body and fills in
  // req.body; without it req.body is undefined and a login would have nothing to
  // read. It replaces a hand-rolled stream read in every endpoint.
  //
  // res.json() does in one call what slice 6 took three lines for: status 200,
  // Content-Type: application/json, stringify, end. Express also 404s any unmatched
  // path on its own, so there is no manual fallthrough to guard.
  //
  // /health exists because Railway and most platforms poll one to decide whether this
  // instance should receive traffic. /echo is temporary — it proves body parsing works
  // and goes away when POST /register lands.
  const app = express();
  app.use(express.json());
  app.get("/health", (req: Request, res: Response) => {
    res.json({ok: true});
  });

  // Create a user, storing only a bcrypt hash of the password — never the password.
  //
  // req.body is typed `any` because Express cannot know what a client sends, so it is
  // CHECKED rather than asserted. The password length is checked here and not in the
  // schema because the schema only ever sees the hash, which is always ~60 chars.
  //
  // The 10 is bcrypt's cost factor: 2^10 iterations, deliberately slow to make
  // brute-forcing stolen hashes expensive. A fresh random salt is generated per call
  // and embedded in the output, which is why there is no separate salt field and why
  // hashing the same password twice gives different strings.
  //
  // A duplicate username does NOT arrive as a Mongoose ValidationError: `unique: true`
  // creates an index in Mongo, so Mongo itself throws with code 11000. `catch (err)` is
  // left unannotated (TS types it `unknown` under strict) and narrowed with
  // `instanceof`, which is a real runtime check rather than an assertion.
  //
  // The response carries id and username only. `res.json(user)` would ship the hash
  // to the client, which it never needs.
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

  // An Express app IS a request handler of exactly the shape createServer wants, so it
  // drops in where slice 6's hand-written function was. Everything below is unchanged:
  // the WebSocket server attaches to this same HTTP server, and HTTP vs WebSocket is
  // still decided by the Upgrade header on one port.
  // Exchange a correct username + password for a signed token.
  //
  // bcrypt.compare cannot un-hash anything: it slices the salt out of the stored
  // 60-char hash ($2b$ / cost / 22-char salt / 31-char digest), hashes the submitted
  // password with that same salt and cost, and compares digests.
  //
  // The 401 is deliberately IDENTICAL for "no such user" and "wrong password".
  // Distinguishing them turns this endpoint into a way to discover which usernames
  // exist. (A hardened version would also take the same TIME in both cases; a fast
  // reply means no hash was compared. Out of scope, but that side channel is real.)
  //
  // The token's payload is base64, NOT encrypted — anyone holding it can read `sub`.
  // What makes it trustworthy is the signature: altering the payload invalidates it,
  // and producing a valid one requires JWT_SECRET. The server stores NOTHING; every
  // later request re-proves itself from the token alone, which is why two instances
  // can both verify with no shared session store.
  //
  // expiresIn adds an `exp` field that jwt.verify() compares against the clock. It
  // limits the damage window if a token is stolen, but a token cannot be revoked
  // before it expires — that is the trade-off against server-side sessions, which
  // are revocable at the cost of a lookup per request.
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

  const httpServer = createServer(app);

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
