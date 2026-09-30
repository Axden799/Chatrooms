import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * A conversation between two or more users.
 *
 * `participantIds` is stored on the chat rather than membership living in its own
 * collection. At portfolio scale a plain array + query is correct — this is the
 * SIMPLIFY that replaces HelloInterview's GSI reverse-lookup for group membership.
 * Messages are NOT embedded here; see the note in Message.ts.
 */
const chatSchema = new Schema(
  {
    /**
     * Only "direct" is used in slice 2. The field exists now anyway so that adding
     * groups later is a code change rather than a data migration — every existing
     * document already carries a correct value.
     */
    type: {
      type: String,
      enum: ["direct", "group"],
      required: true,
      default: "direct",
    },

    /** Exactly 2 entries for a direct chat. Unbounded (small) for a group. */
    participantIds: {
      type: [Schema.Types.ObjectId],
      required: true,
      validate: {
        validator: (ids: unknown[]) => ids.length >= 2,
        message: "a chat needs at least 2 participants",
      },
    },

    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

// Answers "which chats is this user in?" — Mongo indexes each element of an array
// field individually, so this one index covers membership lookups for every user.
chatSchema.index({ participantIds: 1 });

export type Chat = InferSchemaType<typeof chatSchema>;
export type ChatDocument = HydratedDocument<Chat>;

export const ChatModel = model("Chat", chatSchema);
