import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { readUserId } from "../src/server.js";

/**
 * WORKED EXAMPLE — pure unit tests.
 *
 * No server, no database, no sockets. readUserId is just a function over a request-like
 * object, so we hand it a plain `{ url }` and check what comes back. These run in
 * microseconds; write as many as you like.
 */
describe("readUserId", () => {
  it("extracts a valid ObjectId from the query string", () => {
    const id = new Types.ObjectId();
    const result = readUserId({ url: `/?userId=${id.toString()}` });
    // ObjectIds don't compare with toBe() — different objects, same value.
    expect(result?.toString()).toBe(id.toString());
  });

  it("returns null when userId is absent", () => {
    expect(readUserId({ url: "/" })).toBeNull();
  });

  it("returns null when userId is not a valid ObjectId", () => {
    expect(readUserId({ url: "/?userId=banana" })).toBeNull();
  });

  it("returns null when userId is present but empty", () => {
    expect(readUserId({ url: "/?userId=" })).toBeNull();
  });

  it("ignores unrelated query parameters", () => {
    const id = new Types.ObjectId();
    const result = readUserId({ url: `/?foo=bar&userId=${id.toString()}&baz=1` });
    expect(result?.toString()).toBe(id.toString());
  });

  it("handles a missing url", () => {
    expect(readUserId({ url: undefined })).toBeNull();
  });
});
