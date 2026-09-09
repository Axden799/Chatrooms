import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * A single chat message.
 *
 * Own collection, deliberately NOT embedded as an array inside Chat: messages are
 * unbounded and an embedded array would eventually hit Mongo's 16MB per-document
 * limit. That embed-vs-reference call is a talking point in itself — see DESIGN.md.
 */
const messageSchema = new Schema(
  {
    chatId: { type: Schema.Types.ObjectId, required: true },
    senderId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },

    /**
     * Set by the server, never trusted from the client — this is the single
     * authoritative clock that makes ordering correct. It is the SIMPLIFY that
     * replaces HelloInterview's NTP-synced multi-server clocks plus sequence-number
     * gap detection: with one clock, ordering is trivially correct.
     */
    serverTimestamp: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

// Reading a chat's history = "this chat, newest first". This one index serves that
// directly, AND serves plain { chatId } lookups on its own — an index works for any
// leftmost prefix of its fields. That's why chatId does NOT also carry `index: true`:
// a standalone chatId index would be pure cost, slowing writes for no read benefit.
messageSchema.index({ chatId: 1, serverTimestamp: -1 });

// InferSchemaType derives the TS type from the schema, so the type and the
// validation can't drift apart. Closest Python analogue: a Pydantic model that is
// simultaneously the validator and the type.
export type Message = InferSchemaType<typeof messageSchema>;
export type MessageDocument = HydratedDocument<Message>;

export const MessageModel = model("Message", messageSchema);
