/**
 * Seed a direct chat between two users so slice 2 has something to send into.
 *
 * There are no User records yet — see "Deferred work" in DESIGN.md. A userId here is
 * just an ObjectId that the client claims in the WebSocket handshake query string.
 *
 *   npm run seed
 *
 * Re-running wipes the previous seed so the printed ids are always the live ones.
 */
import mongoose, { Types } from "mongoose";
import { config } from "../config.js";
import { ChatModel } from "../models/Chat.js";
import { MessageModel } from "../models/Message.js";

async function seed(): Promise<void> {
  await mongoose.connect(config.mongoUrl);

  await ChatModel.deleteMany({});
  await MessageModel.deleteMany({});

  const alice = new Types.ObjectId();
  const bob = new Types.ObjectId();

  const chat = await ChatModel.create({
    type: "direct",
    participantIds: [alice, bob],
  });

  console.log(`
  Seeded a direct chat. Open public/client.html in TWO browser tabs and use:

    ── Tab A ──────────────────────────────
    userId  ${alice.toString()}
    chatId  ${chat._id.toString()}

    ── Tab B ──────────────────────────────
    userId  ${bob.toString()}
    chatId  ${chat._id.toString()}

  Same chatId in both tabs, different userId. Click Connect in each.
`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
