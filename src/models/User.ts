import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * A user account.
 *
 * Note the field name: `passwordHash`, never `password`. The plain password is read
 * from the request, hashed, and then exists nowhere — not in this schema, not in the
 * database, not in a log. Naming the field for what it actually holds makes an
 * accidental `user.password = req.body.password` impossible to write by habit.
 */
const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,

      /**
       * `unique: true` is NOT a validator — it creates a unique INDEX in Mongo. The
       * consequence matters for the route: a duplicate does not produce a Mongoose
       * ValidationError, it produces a MongoServerError with `code === 11000` thrown
       * by the database. You have to handle that code specifically.
       */
      unique: true,

      trim: true,

      /**
       * Store usernames lowercased so "Denis" and "denis" cannot become two accounts.
       * Mongoose applies this before saving AND before querying, so a login with
       * "Denis" still finds the user stored as "denis".
       */
      lowercase: true,

      minlength: 3,
      maxlength: 32,
    },

    /** A bcrypt hash — around 60 characters, beginning `$2b$`. */
    passwordHash: { type: String, required: true },

    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model("User", userSchema);
