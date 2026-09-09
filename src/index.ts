import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { connectToMongo, disconnectFromMongo } from "./db.js";
import { MessageModel } from "./models/Message.js";

/**
 * SLICE 1 — the thinnest end-to-end thread.
 *
 * Goal: one client connects over a WebSocket, sends a message, the server stamps it
 * with a server timestamp, persists it to Mongo, and echoes it back.
 *
 * NOT in this slice: pub/sub, inbox, presence, auth, groups. Resist adding them.
 * The only thing being proven here is that the Node + TS + ws + Mongo toolchain
 * works end to end.
 *
 * ---------------------------------------------------------------------------
 * YOUR PART starts at the TODO below. Everything above and below it is plumbing.
 * ---------------------------------------------------------------------------
 */

async function main(): Promise<void> {
  await connectToMongo();

  const wss = new WebSocketServer({ port: config.port });
  console.log(`[ws] listening on ws://localhost:${config.port}`);

  // "connection" fires ONCE each time a client connects. `socket` is that one
  // client's connection — five users online means this ran five times and you have
  // five separate sockets, each with its own handlers registered below.
  wss.on("connection", (socket) => {
    console.log("[ws] client connected");

    // Note this is `async` — you need `await` for the database call inside.
    socket.on("message", async (raw) => {
      try {
        // ---- STEP 1 -----------------------------------------------------
        // `raw` is a Buffer (Node's `bytes`). Two conversions to get an object:
        //   raw.toString()  → string   (bytes.decode())
        //   JSON.parse(...) → object   (json.loads())
        // Declare a const holding the parsed object. Call it `data`.
        //
        // YOUR CODE:
        const data = JSON.parse(raw.toString());


        // ---- STEP 2 -----------------------------------------------------
        // Persist it. `MessageModel.create()` returns a Promise, so `await` it
        // and store the result — the returned document is what you echo back,
        // because it has the _id Mongo assigned.
        //
        //   const saved = await MessageModel.create({
        //     chatId:   ...,      // from data
        //     senderId: ...,      // from data
        //     body:     ...,      // from data
        //     serverTimestamp: new Date(),   // ← from the SERVER, never from data
        //   });
        //
        // That last field is the whole ordering guarantee. If you trust the
        // client's clock, two clients disagree and your message order is wrong.
        // One authoritative clock is what makes ordering trivially correct —
        // it's the SIMPLIFY in DESIGN.md that replaces NTP-synced clocks.
        //
        // YOUR CODE:
        const saved = await MessageModel.create({
          chatId: data.chatId,
          senderId: data.senderId,
          body: data.body,
          serverTimestamp: new Date(),
        });


        // ---- STEP 3 -----------------------------------------------------
        // Echo the saved document back to this client.
        // `socket.send()` takes a STRING — pass it an object and the client
        // receives the literal text "[object Object]".
        // So wrap it: JSON.stringify(saved)   (json.dumps())
        //
        // YOUR CODE:
        socket.send(JSON.stringify(saved))


      } catch (err) {
        // A malformed frame from any client must not kill the server. In Node an
        // uncaught throw inside an event handler takes down the whole process —
        // there's no per-request isolation like a Flask view gives you.
        console.error("[ws] failed to handle message:", err);
      }
    });

    // Separate registration, not an else-branch. Fires when this client leaves.
    // Presence bookkeeping will live here in a later slice.
    socket.on("close", () => {
      console.log("[ws] client disconnected");
    });

    // An unhandled "error" event is another way to crash the process.
    socket.on("error", (err) => {
      console.error("[ws] socket error:", err);
    });
  });

  // Ctrl-C should close the DB pool rather than yanking the process.
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
