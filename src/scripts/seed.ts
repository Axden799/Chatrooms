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
 *
 * Targeting a remote database needs no flag — dotenv does not override a variable that is
 * already set, so a shell assignment wins:
 *
 *   MONGO_URL="mongodb+srv://..." npm run seed -- --yes
 *
 * The --yes is required for any host other than localhost, because the three deleteMany
 * calls below are unguarded. Without it, one forgotten `export MONGO_URL` in a terminal
 * silently destroys production data.
 */
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { config } from "../config.js";
import { UserModel } from "../models/User.js";
import { ChatModel } from "../models/Chat.js";
import { MessageModel } from "../models/Message.js";

const PASSWORD = "hunter2pw";

/** Hostname and database name, for printing — never the credentials in the URL. */
function describeTarget(mongoUrl: string): { host: string; database: string } {
  const url = new URL(mongoUrl);
  return {
    host: url.hostname,
    database: url.pathname.replace(/^\//, "") || "(default)",
  };
}

async function seed(): Promise<void> {
  const { host, database } = describeTarget(config.mongoUrl);
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const confirmed = process.argv.includes("--yes");

  if (!isLocal && !confirmed) {
    console.error(`
  REFUSING TO SEED — this is not a local database.

    host      ${host}
    database  ${database}

  Seeding DELETES every user, chat and message first. Re-run with --yes if that is
  what you want:

    npm run seed -- --yes
`);
    process.exit(1);
  }

  console.log(`[seed] wiping and seeding ${database} on ${host}`);
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

  Open the frontend in two tabs, click "log in as alice" in one and "log in as bob"
  in the other, pick the same chat, and type. carol exists to prove the participant
  check rejects a non-member.
`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
