import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Types } from "mongoose";
import WebSocket from "ws";
import { createServer, type ServerHandle } from "../src/server.js";
import { ChatModel } from "../src/models/Chat.js";
import { MessageModel } from "../src/models/Message.js";
import { connect, nextMessage, expectNoMessage, nextClose } from "./helpers.js";

/**
 * WORKED EXAMPLE — integration tests. This is the automated version of the two-tab
 * manual test, and it is where most of the confidence lives.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The "handshake" block PASSES now — that code is already written.         │
 * │ The rest FAIL until you implement YOUR CODE #1, #2a, #2b and #3.         │
 * │ Treat them as the spec: run `npm run test:watch` and turn them green.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Port 0 means "OS, pick any free port" — so tests never collide with the dev server
 * on 8080, and many test files can run at once.
 */
let server: ServerHandle;
const open: WebSocket[] = [];

beforeEach(async () => {
  server = await createServer({ port: 0 });
});

afterEach(async () => {
  for (const ws of open.splice(0)) ws.close();
  await server.close();
});

/** Connect and remember the socket so afterEach can clean it up. */
async function client(userId: Types.ObjectId): Promise<WebSocket> {
  const ws = await connect(server.port, userId.toString());
  open.push(ws);
  return ws;
}

/** Two users and a direct chat between them. */
async function seedChat() {
  const alice = new Types.ObjectId();
  const bob = new Types.ObjectId();
  const chat = await ChatModel.create({ type: "direct", participantIds: [alice, bob] });
  return { alice, bob, chatId: chat._id.toString() };
}

describe("handshake identity — passes already", () => {
  it("rejects a connection with no userId", async () => {
    const ws = new WebSocket(`ws://localhost:${server.port}/`);
    const { code, reason } = await nextClose(ws);
    expect(code).toBe(1008);
    expect(reason).toMatch(/userId/);
  });

  it("rejects a userId that is not a valid ObjectId", async () => {
    const ws = new WebSocket(`ws://localhost:${server.port}/?userId=banana`);
    const { code } = await nextClose(ws);
    expect(code).toBe(1008);
  });

  it("accepts a valid userId", async () => {
    const ws = await client(new Types.ObjectId());
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("routing — needs YOUR CODE #1, #2a, #3", () => {
  it("delivers a message from one participant to the other", async () => {
    const { alice, bob, chatId } = await seedChat();
    const a = await client(alice);
    const b = await client(bob);

    a.send(JSON.stringify({ chatId, body: "hello bob" }));

    const received = await nextMessage(b);
    expect(received.body).toBe("hello bob");
    expect(received.senderId).toBe(alice.toString());
  });

  it("echoes the message back to the sender, carrying its _id", async () => {
    const { alice, bob, chatId } = await seedChat();
    const a = await client(alice);
    await client(bob);

    a.send(JSON.stringify({ chatId, body: "hello" }));

    const echoed = await nextMessage(a);
    expect(echoed._id).toBeDefined();
    expect(echoed.serverTimestamp).toBeDefined();
  });

  it("takes senderId from the connection, not the payload", async () => {
    const { alice, bob, chatId } = await seedChat();
    const a = await client(alice);
    await client(bob);

    // Alice lies about who she is. The server must ignore it.
    a.send(JSON.stringify({ chatId, body: "spoofed", senderId: bob.toString() }));

    const echoed = await nextMessage(a);
    expect(echoed.senderId).toBe(alice.toString());
  });

  it("persists the message with the server's own timestamp", async () => {
    const { alice, bob, chatId } = await seedChat();
    const a = await client(alice);
    await client(bob);

    a.send(JSON.stringify({ chatId, body: "persist me" }));
    await nextMessage(a);

    const stored = await MessageModel.find({ chatId });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.body).toBe("persist me");
    expect(stored[0]?.senderId.toString()).toBe(alice.toString());
  });
});

describe("authorization — needs YOUR CODE #3a", () => {
  it("ignores a message from someone who is not in the chat", async () => {
    const { alice, bob, chatId } = await seedChat();
    await client(alice);
    const b = await client(bob);

    const mallory = await client(new Types.ObjectId());
    mallory.send(JSON.stringify({ chatId, body: "let me in" }));

    await expectNoMessage(b);
    expect(await MessageModel.countDocuments({ chatId })).toBe(0);
  });

  it("ignores a message for a chat that does not exist", async () => {
    const alice = new Types.ObjectId();
    const a = await client(alice);

    a.send(JSON.stringify({ chatId: new Types.ObjectId().toString(), body: "nowhere" }));

    await expectNoMessage(a);
    expect(await MessageModel.countDocuments({})).toBe(0);
  });
});

describe("registry lifecycle — needs YOUR CODE #2a and #2b", () => {
  it("replaces an existing connection when the same user reconnects", async () => {
    const { alice, bob, chatId } = await seedChat();
    const first = await client(alice);
    const b = await client(bob);

    // Alice opens a second tab. The first socket should be closed by the server.
    const closed = nextClose(first, 3000);
    await client(alice);
    await expect(closed).resolves.toBeDefined();

    // And the NEW socket is the one that receives.
    b.send(JSON.stringify({ chatId, body: "who gets this" }));
    // (the reconnected alice socket is the last one pushed to `open`)
    const latest = open[open.length - 1]!;
    const received = await nextMessage(latest);
    expect(received.body).toBe("who gets this");
  });

  it("stops delivering to a user who has disconnected", async () => {
    const { alice, bob, chatId } = await seedChat();
    const a = await client(alice);
    const b = await client(bob);

    b.close();
    await new Promise((r) => setTimeout(r, 100));

    // Should not throw, and should still persist.
    a.send(JSON.stringify({ chatId, body: "bob is away" }));
    await nextMessage(a);

    expect(await MessageModel.countDocuments({ chatId })).toBe(1);
  });
});

describe("KNOWN GAP — offline delivery, filled by the inbox slice", () => {
  it("does NOT deliver a message sent while the recipient was offline", async () => {
    const { alice, bob, chatId } = await seedChat();
    const a = await client(alice);

    // Bob was never connected when the message was sent.
    a.send(JSON.stringify({ chatId, body: "you were away" }));
    await nextMessage(a);

    // Bob connects afterwards and receives nothing. This test documents the gap
    // deliberately — when the inbox slice lands, this expectation FLIPS.
    const b = await client(bob);
    await expectNoMessage(b);

    // The message exists in history; it just was never pushed to Bob.
    expect(await MessageModel.countDocuments({ chatId })).toBe(1);
  });
});
