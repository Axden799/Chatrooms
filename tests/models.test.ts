import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { MessageModel } from "../src/models/Message.js";
import { ChatModel } from "../src/models/Chat.js";

/**
 * WORKED EXAMPLE — model tests against a real (in-memory) Mongo.
 *
 * These assert the SCHEMA is doing its job: casting, validating, rejecting. Worth
 * having because a Mongoose schema is the only thing enforcing shape — Mongo itself
 * will happily store anything.
 */
describe("Message model", () => {
  it("casts a hex string chatId into an ObjectId", async () => {
    const chatId = new Types.ObjectId();
    const saved = await MessageModel.create({
      chatId: chatId.toString(),      // a STRING goes in
      senderId: new Types.ObjectId(),
      body: "hello",
      serverTimestamp: new Date(),
    });
    // ...an ObjectId comes back out. This is the cast that makes queries work.
    expect(saved.chatId).toBeInstanceOf(Types.ObjectId);
    expect(saved.chatId.toString()).toBe(chatId.toString());
  });

  it("rejects a body longer than 4000 characters", async () => {
    await expect(
      MessageModel.create({
        chatId: new Types.ObjectId(),
        senderId: new Types.ObjectId(),
        body: "x".repeat(4001),
        serverTimestamp: new Date(),
      }),
    ).rejects.toThrow(/maxlength|longer/i);
  });

  it("rejects an invalid chatId with a CastError", async () => {
    await expect(
      MessageModel.create({
        chatId: "banana",
        senderId: new Types.ObjectId(),
        body: "hello",
        serverTimestamp: new Date(),
      }),
    ).rejects.toThrow(/Cast to ObjectId failed/);
  });

  it("defaults serverTimestamp when omitted", async () => {
    const before = Date.now();
    const saved = await MessageModel.create({
      chatId: new Types.ObjectId(),
      senderId: new Types.ObjectId(),
      body: "hello",
    });
    expect(saved.serverTimestamp.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("Chat model", () => {
  it("requires at least two participants", async () => {
    await expect(
      ChatModel.create({ type: "direct", participantIds: [new Types.ObjectId()] }),
    ).rejects.toThrow(/at least 2 participants/);
  });

  it("defaults type to direct", async () => {
    const chat = await ChatModel.create({
      participantIds: [new Types.ObjectId(), new Types.ObjectId()],
    });
    expect(chat.type).toBe("direct");
  });
});
