import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * One row = one note saying "this user still needs this message".
 *
 * A note is written for every participant when a message is sent, and torn up by
 * whichever server instance actually delivers it. Whatever is left belongs to someone
 * who was offline, and gets flushed to them when they next connect.
 *
 * Why notes are written for everyone and then deleted, rather than written only for
 * people who look offline: no single instance knows who is online. Instance 1 looking
 * in its own Map and not finding Bob proves nothing — Bob may be fine on instance 2.
 * If instance 1 wrote a note on that basis, Bob would get the message twice. Only the
 * instance that actually delivered can be certain, so only it tears up the note.
 *
 * Stores a messageId rather than a copy of the message. The messages collection already
 * holds the content, so copying it would mean two sources of truth for the same text.
 * The cost is one extra query on flush.
 */
const inboxSchema = new Schema(
  {
    /** Who is owed a message. */
    userId: { type: Schema.Types.ObjectId, required: true },

    /** Which message they are owed — an _id from the messages collection. */
    messageId: { type: Schema.Types.ObjectId, required: true },

    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

/**
 * Serves the flush query: "this user's notes, oldest first".
 */
inboxSchema.index({ userId: 1, createdAt: 1 });

/**
 * A TTL index: Mongo deletes these rows by itself once createdAt is more than a week
 * old. A note nobody collected in seven days belongs to an abandoned account, and
 * without this the collection grows forever.
 *
 * Two details worth knowing. TTL indexes must be SINGLE-FIELD — that is why this cannot
 * be folded into the compound index above. And deletion is not instant: a background
 * task sweeps expired rows roughly once a minute, so a row may outlive its expiry
 * briefly.
 */
inboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export type Inbox = InferSchemaType<typeof inboxSchema>;
export type InboxDocument = HydratedDocument<Inbox>;

export const InboxModel = model("Inbox", inboxSchema);
