import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * A conversation and its membership.
 *
 * `participantIds` lives on the chat rather than in a separate membership collection.
 * At portfolio scale a plain array plus a query is correct — this is the SIMPLIFY that
 * replaces the GSI reverse-lookup in the HelloInterview breakdown.
 *
 * There is deliberately no `type: '1:1' | 'group'` field, though DESIGN.md lists one:
 * it is derivable from participantIds.length, so storing it is redundant data that can
 * drift out of sync. Add it when a group needs something a 1:1 does not — a name, say.
 *
 * Messages are NOT embedded here; see the note in Message.ts.
 */
const chatSchema = new Schema(
  {
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

// Answers "which chats is this user in?". Mongo indexes each element of an array field
// individually, so this one index covers membership lookups for every user.
chatSchema.index({ participantIds: 1 });

export type Chat = InferSchemaType<typeof chatSchema>;
export type ChatDocument = HydratedDocument<Chat>;

export const ChatModel = model("Chat", chatSchema);
