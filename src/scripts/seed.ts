/**
 * Create real user accounts and a chat between two of them.
 *
 *   npm run seed
 *
 * Why this changed in slice 8: it used to invent fake userIds like
 * 000000000000000000000001 and put those in a chat's participantIds. That worked
 * while the handshake accepted `?userId=` — the client just claimed one. Now identity
 * comes from a verified token, so a userId is whatever Mongo assigned at registration.
 * A chat seeded with made-up ids would have participants who do not exist, and every
 * message would be rejected by the participant check.
 *
 * Re-running wipes users, chats and messages so the printed credentials are the live ones.
 */
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { config } from "../config.js";
import { UserModel } from "../models/User.js";
import { ChatModel } from "../models/Chat.js";
import { MessageModel } from "../models/Message.js";

const PASSWORD = "hunter2pw";

async function seed(): Promise<void> {
  await mongoose.connect(config.mongoUrl);

  await UserModel.deleteMany({});
  await ChatModel.deleteMany({});
  await MessageModel.deleteMany({});
  await UserModel.createIndexes();

  // The same password for all three, hashed once — this is seed data, not a pattern
  // to copy. Each account would normally hash its own.
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [alice, bob, carol] = await UserModel.create([
    { username: "alice", passwordHash },
    { username: "bob", passwordHash },
    { username: "carol", passwordHash },
  ]);

  const chat = await ChatModel.create({
    participantIds: [alice!._id, bob!._id],
  });

  console.log(`
  Seeded three accounts. All passwords: ${PASSWORD}

    alice   ${alice!._id.toString()}   IN the chat
    bob     ${bob!._id.toString()}   IN the chat
    carol   ${carol!._id.toString()}   NOT in the chat

  chatId    ${chat._id.toString()}

  In public/client.html: Login as alice, Connect, paste the chatId, send.
  Then a second tab as bob — the message crosses. A third as carol — rejected.
`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
