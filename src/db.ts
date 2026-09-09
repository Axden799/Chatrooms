import mongoose from "mongoose";
import { config } from "./config.js";

/**
 * Mongoose keeps a single global connection pool, so this is called once at boot
 * and every model import reuses it. No session/connection object gets passed around
 * the way you would with a SQLAlchemy Session.
 */
export async function connectToMongo(): Promise<void> {
  mongoose.connection.on("error", (err) => {
    console.error("[mongo] connection error:", err);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[mongo] disconnected");
  });

  await mongoose.connect(config.mongoUrl);
  console.log("[mongo] connected");
}

export async function disconnectFromMongo(): Promise<void> {
  await mongoose.disconnect();
  console.log("[mongo] disconnected");
}
