import WebSocket from "ws";

/**
 * Helpers for driving a real WebSocket server from tests.
 *
 * There is no supertest equivalent for WebSockets, so the standard Node approach is
 * exactly this: boot the real server, connect real clients, assert what arrives.
 * These wrappers turn the event-callback API into promises so tests can `await`.
 */

/** Connect, and resolve once the socket is actually open. */
export function connect(port: number, userId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/?userId=${userId}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("close", (code, reason) =>
      reject(new Error(`closed before opening: ${code} ${reason.toString()}`)),
    );
  });
}

/** Resolve with the next message this socket receives, or reject after `ms`. */
export function nextMessage(ws: WebSocket, ms = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`no message received within ${ms}ms`));
    }, ms);
    function onMessage(raw: WebSocket.RawData) {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(JSON.parse(raw.toString()));
    }
    ws.on("message", onMessage);
  });
}

/**
 * Assert that NO message arrives within `ms`.
 *
 * Needed for negative cases — "a non-participant receives nothing", "an offline user
 * gets nothing". Proving absence requires actually waiting, so keep `ms` small.
 */
export async function expectNoMessage(ws: WebSocket, ms = 400): Promise<void> {
  try {
    const msg = await nextMessage(ws, ms);
    throw new Error(`expected no message, but received: ${JSON.stringify(msg)}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("no message received")) return;
    throw err;
  }
}

/** Wait for a socket to close, resolving with the close code. */
export function nextClose(ws: WebSocket, ms = 2000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`socket did not close within ${ms}ms`)), ms);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}
