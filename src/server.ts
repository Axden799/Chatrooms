// WebSocket is imported as a VALUE (not `type WebSocket`) so the readyState
// constants — WebSocket.OPEN, .CLOSED, .CONNECTING, .CLOSING — are usable at runtime.
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Types } from "mongoose";
import { MessageModel } from "./models/Message.js";
import { ChatModel } from "./models/Chat.js";

/**
 * The WebSocket server, as an importable factory.
 *
 * Nothing here starts on import and nothing reads config — a caller passes the port
 * and gets back a handle it can close. That is what makes this testable: a test boots
 * it on port 0 (the OS picks a free port), drives it with real clients, then closes it.
 * Same idea as Flask's create_app(); Node just has you write the four lines yourself.
 *
 * Mongo is NOT connected here. The caller connects first — production against the
 * container, tests against an in-memory instance.
 */

export interface ServerHandle {
  /** The port actually bound. Differs from the requested port when you pass 0. */
  port: number;
  close(): Promise<void>;
}

/**
 * Pull `?userId=...` off the upgrade request.
 *
 * A WebSocket connection begins as an ordinary HTTP GET carrying `Upgrade: websocket`.
 * `req` IS that HTTP request — the one moment headers and a URL exist. After the server
 * answers 101 Switching Protocols there are no more URLs, only frames. So the handshake
 * is the only place identity can be established.
 *
 * Exported so it can be unit tested directly, with no server and no socket.
 */
export function readUserId(req: Pick<IncomingMessage, "url">): Types.ObjectId | null {
  // req.url is a path ("/?userId=abc"), and URL demands an absolute one — hence the base.
  const url = new URL(req.url ?? "/", "http://placeholder");
  const raw = url.searchParams.get("userId");
  if (!raw || !Types.ObjectId.isValid(raw)) return null;
  return new Types.ObjectId(raw);
}

export function createServer(options: { port: number }): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: options.port });

    // =========================================================================
    // YOUR CODE #1 — the connection registry.   ONE LINE.
    //
    // A lookup from userId -> that user's live socket, so a message can be routed.
    // Declare it HERE (inside createServer, before wss.on("connection")).
    //
    // Python equivalent:   connections = {}          # dict[str, WebSocket]
    // TypeScript:          const connections = new Map<string, WebSocket>();
    //
    // The <string, WebSocket> part is a GENERIC — it tells TS "keys are strings,
    // values are WebSockets", the way dict[str, WebSocket] does in a type hint.
    // Without it TS infers Map<any, any> and you lose all checking.
    //
    // Key is `string`, never ObjectId: Map compares keys with === (identity). Two
    // ObjectId objects holding the same 24 hex chars are DIFFERENT objects, so
    // .get() would always miss. Always key on userId.toString().
    //
    // Copy that one line in, then move to #2a.
    // =========================================================================
    // YOUR CODE #1 — the connection registry.
    //
    // You need a lookup from userId to that user's live socket, so a message can be
    // routed to them. Declare it HERE, inside createServer.
    //
    //   const connections = new Map<string, WebSocket>();
    //
    // Why a Map and not a plain object: object keys are always strings and the API is
    // clumsier. Map is the real dict equivalent — .set(), .get(), .delete(), .has().
    //
    // Why the key is `string` and not ObjectId: Map compares keys by IDENTITY. Two
    // ObjectId objects holding the same value are different objects, so .get() would
    // always miss. Always key on userId.toString().
    //
    // Why inside createServer rather than at module scope: each server instance gets
    // its OWN registry. That is the entire reason slice 3 needs Redis Pub/Sub — and
    // you can prove it in a test by booting two servers and watching a message from a
    // client on server A never reach a client on server B.
    // =========================================================================


    wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      const userId = readUserId(req);

      // No valid identity, no connection. 1008 = Policy Violation.
      if (!userId) {
        console.warn("[ws] rejected a connection with a missing/invalid userId");
        socket.close(1008, "a valid userId query parameter is required");
        return;
      }

      const userKey = userId.toString();
      console.log(`[ws] connected: ${userKey}`);

      // =======================================================================
      // YOUR CODE #2a — register this socket.   THREE STEPS.
      //
      // The whole Map API you need:
      //     connections.get(key)       -> WebSocket | undefined   (Python: d.get(k))
      //     connections.set(key, val)  -> void                    (Python: d[k] = v)
      //     connections.delete(key)    -> boolean                 (Python: del d[k])
      //
      // WORKED EXAMPLE — same pattern, different domain. A game lobby where each
      // player may hold only one seat:
      //
      //     const seats = new Map<string, Player>();
      //
      //     const previous = seats.get(playerName);   // who is sitting here?
      //     if (previous) {                           // undefined is falsy
      //       previous.standUp();                     // evict the old occupant
      //     }
      //     seats.set(playerName, newPlayer);         // seat the new one
      //
      // Your three steps have exactly that shape:
      //
      //   1. Look up whether `userKey` already has a socket; put it in a const.
      //      `.get()` returns `WebSocket | undefined`. That union type is TS telling
      //      you it might be missing, so you must check before using it.
      //
      //   2. If you got one, close it. A second browser tab means the first tab's
      //      socket is stale, and DESIGN.md cuts multi-device: one socket per user.
      //      close() takes an optional code + reason, like the 1008 call above:
      //          oldSocket.close(1000, "replaced by a newer connection");
      //      1000 = Normal Closure (1008 was Policy Violation).
      //
      //      Skip this and the first tab silently stops receiving while still
      //      looking connected — a genuinely confusing bug to chase.
      //
      //   3. Store the CURRENT socket under `userKey`.
      //
      // YOUR CODE:


      // =======================================================================
      // YOUR CODE #2a — register this socket.
      //
      // Put this socket in the Map under `userKey`.
      //
      // Handle the reconnect case: if that user already has a socket registered (a
      // stale tab, a refresh), close the OLD one before overwriting. DESIGN.md cuts
      // multi-device, so one socket per user. Skip this and the first tab silently
      // stops receiving messages — a genuinely confusing bug to chase.
      //
      // YOUR CODE:


      // =======================================================================

      socket.on("message", async (raw) => {
        try {
          // Note: no senderId here any more. It's `userId`, from the handshake.
          const data = JSON.parse(raw.toString());

          // ===================================================================
          // YOUR CODE #3 — authorize, persist, deliver.   THREE PARTS, 3a/3b/3c.
          //
          // -------- 3a. AUTHORIZE ------------------------------------------
          //
          // Load the chat. findById returns a Promise, so await it. If nothing
          // matches you get `null`, NOT an exception (no Python KeyError here):
          //
          //     const chat = await ChatModel.findById(data.chatId);
          //     if (!chat) return;          // no such chat — ignore this message
          //
          // Now check the sender really is in it. participantIds is an array of
          // ObjectIds, and ObjectIds do NOT compare with === — two objects holding
          // the same hex are different objects. Compare .toString() values.
          //
          // `.some()` is Python's any() with a generator. These are equivalent:
          //
          //     any(str(id) == user_key for id in chat.participant_ids)   # Python
          //     chat.participantIds.some((id) => id.toString() === userKey)
          //
          // So:
          //     const isParticipant = chat.participantIds.some(
          //       (id) => id.toString() === userKey,
          //     );
          //     if (!isParticipant) return;
          //
          // Without this check anyone can post into any chat by guessing an id —
          // the difference between a chat app and an open relay.
          //
          // -------- 3b. PERSIST --------------------------------------------
          //
          // Same as slice 1, with one critical change — senderId comes from the
          // HANDSHAKE (`userId`), never from `data`:
          //
          //     const saved = await MessageModel.create({
          //       chatId: chat._id,
          //       senderId: userId,          // <- from the connection, not the payload
          //       body: data.body,
          //       serverTimestamp: new Date(),
          //     });
          //
          // -------- 3c. DELIVER --------------------------------------------
          //
          // Loop the participants, look each one up in the registry, and send to
          // whoever is connected. Include the sender — that is how their own
          // message comes back to them carrying its _id.
          //
          // `for...of` iterates VALUES (Python's plain `for x in xs`). Do not use
          // `for...in` — that gives you "0", "1", "2" as strings, which is almost
          // always a bug.
          //
          //     for (const id of chat.participantIds) {
          //       const peer = connections.get(id.toString());
          //       if (peer && peer.readyState === WebSocket.OPEN) {
          //         peer.send(JSON.stringify(saved));
          //       }
          //     }
          //
          // Two guards in that `if`, and you need BOTH:
          //   * `peer &&`                      -> they might not be connected at all
          //   * `readyState === WebSocket.OPEN` -> the socket might be mid-close;
          //                                        sending to a closing socket throws
          //
          // send() takes a STRING, so JSON.stringify first (Python: json.dumps).
          //
          // Participants who are not in the Map get nothing, and the message does
          // NOT reach them later. That is the offline gap the inbox slice fills —
          // one test asserts that failure on purpose.
          //
          // YOUR CODE:


          // ===================================================================
          // YOUR CODE #3 — authorize, persist, deliver.
          //
          // (a) AUTHORIZE. Load the chat by data.chatId:
          //
          //       const chat = await ChatModel.findById(data.chatId);
          //
          //     Then verify this sender is actually a participant. Without this
          //     check anyone can post into any chat by guessing an id — the
          //     difference between a chat app and an open relay.
          //
          //     participantIds holds ObjectIds, which do NOT compare with === .
          //     Two ObjectIds with the same value are different objects. Use
          //     .equals(), or compare .toString() values:
          //
          //       const isParticipant = chat.participantIds.some(
          //         (id) => id.toString() === userKey,
          //       );
          //
          //     Bail out (return) if the chat is missing or the sender isn't in it.
          //
          // (b) PERSIST. Same as slice 1, but senderId comes from the handshake:
          //
          //       const saved = await MessageModel.create({
          //         chatId: chat._id,
          //         senderId: userId,        // ← from the connection, not the payload
          //         body: data.body,
          //         serverTimestamp: new Date(),
          //       });
          //
          // (c) DELIVER. For each participant, look them up in the Map and send if
          //     they're connected. Include the sender — that's how their own message
          //     comes back carrying its _id.
          //
          //       for (const id of chat.participantIds) {
          //         const peer = connections.get(id.toString());
          //         if (peer?.readyState === peer?.OPEN) {
          //           peer.send(JSON.stringify(saved));
          //         }
          //       }
          //
          //     Check readyState before sending: a socket can be mid-close and
          //     sending to it throws. `?.` is optional chaining — Python's
          //     equivalent of guarding for None before attribute access.
          //
          //     Participants who aren't in the Map get nothing, and the message does
          //     NOT reach them later. That's the offline gap the inbox slice fills.
          //
          // YOUR CODE:


          // ===================================================================
        } catch (err) {
          console.error("[ws] failed to handle message:", err);
        }
      });

      socket.on("close", () => {
        console.log(`[ws] disconnected: ${userKey}`);

        // =====================================================================
        // YOUR CODE #2b — deregister.   TWO LINES, but read the subtlety.
        //
        // Remove this user from the registry. Two reasons it matters: a Map that
        // only grows is a memory leak, and a stale entry means 3c would try to
        // send into a dead socket instead of recognising the user as offline.
        //
        // The naive version is WRONG:
        //
        //     connections.delete(userKey);        // <- do not do this
        //
        // Why: on a fast reconnect (a refresh), #2a has ALREADY replaced this
        // entry with the new socket before this close handler runs. A blind delete
        // would then evict the live connection, and that user goes silently deaf.
        //
        // So delete only if the socket registered under `userKey` is STILL this
        // one. Sockets are objects, so === compares identity — exactly what you
        // want here (Python: `is`):
        //
        //     if (connections.get(userKey) === socket) {
        //       connections.delete(userKey);
        //     }
        //
        // YOUR CODE:


        // =====================================================================
        // YOUR CODE #2b — deregister.
        //
        // Remove this user from the Map. Two reasons it matters: a Map that only
        // grows is a memory leak, and a stale entry means messages get sent into a
        // dead socket instead of being recognised as undeliverable.
        //
        // One subtlety: only delete if the registered socket is STILL this one. On a
        // fast reconnect the new socket may already have replaced this entry, and a
        // blind delete would evict the live connection.
        //
        // YOUR CODE:


        // =====================================================================
      });

      socket.on("error", (err) => {
        console.error(`[ws] socket error for ${userKey}:`, err);
      });
    });

    wss.on("error", reject);

    wss.on("listening", () => {
      const address = wss.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((res, rej) => {
            // Terminate live sockets first — wss.close() waits for them otherwise,
            // which would hang a test run.
            for (const client of wss.clients) client.terminate();
            wss.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
