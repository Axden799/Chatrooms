/**
 * Create a chat so slice 4 has something to send into, and print the ids to paste
 * into browser tabs.
 *
 *   npm run seed
 *
 * There are no User records yet — a userId is just an ObjectId a client claims in the
 * handshake. Real users and token verification are deferred; see DESIGN.md.
 *
 * Re-running wipes chats and messages so the printed ids are always the live ones.
 */
import mongoose, { Types } from "mongoose";
import { config } from "../config.js";
import { ChatModel } from "../models/Chat.js";
import { MessageModel } from "../models/Message.js";

async function seed(): Promise<void> {
  await mongoose.connect(config.mongoUrl);

  await ChatModel.deleteMany({});
  await MessageModel.deleteMany({});

  // Fixed ids rather than random ones, so they are easy to retype and recognise.
  const alice = new Types.ObjectId("000000000000000000000001");
  const bob = new Types.ObjectId("000000000000000000000002");
  const carol = new Types.ObjectId("000000000000000000000003");

  const chat = await ChatModel.create({ participantIds: [alice, bob] });

  console.log(`
  Seeded one chat containing Alice and Bob. Carol is NOT a member.
  Open public/client.html in three tabs:

    TAB A — Alice (member)
      userId  ${alice.toString()}
      chatId  ${chat._id.toString()}

    TAB B — Bob (member)
      userId  ${bob.toString()}
      chatId  ${chat._id.toString()}

    TAB C — Carol (NOT a member)
      userId  ${carol.toString()}
      chatId  ${chat._id.toString()}

  Send from A: B receives it, C does not.
  Send from C: rejected — nothing stored, nobody receives it.
`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
