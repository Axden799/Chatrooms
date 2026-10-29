# Chatrooms

Real-time chat — WebSockets, Redis Pub/Sub fan-out, MongoDB persistence, and offline
delivery — written in TypeScript on Node.

**Live:** [chatrooms-mu.vercel.app](https://chatrooms-mu.vercel.app) &nbsp;·&nbsp;
**API:** [/health](https://chatrooms-production-e166.up.railway.app/health)

> Open the demo in **two browser tabs**. Click *log in as alice* in one and *log in as
> bob* in the other, pick the same chat in both, and type. Messages cross with no
> refresh. Close bob's tab, send from alice, reopen bob — the missed message is waiting.

Frontend on Vercel, backend + Redis on Railway, Mongo on Atlas.

The design is adapted from the
[HelloInterview WhatsApp breakdown](https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp),
deliberately scaled down to a **single-region, portfolio-grade deployment** — no
consistent hashing, no server registry, no sharding. Where the production design reaches
for distributed infrastructure, this implements the same *patterns* with lighter tools and
documents the scale-up path instead of building it. Knowing when **not** to reach for the
heavy tool is part of the point; every cut is listed at the bottom with what I'd do
instead.

Companion project to [AdClickAggregator](https://github.com/Axden799/AdClickAggregator),
which trained high-throughput ingestion. This one trains the opposite problem:
low-latency bidirectional delivery to connections the server has to hold open.

---

## Architecture

```
            ┌─────────────┐        ┌─────────────┐
   alice ───┤  instance A │        │  instance B ├─── bob
            └──────┬──────┘        └──────▲──────┘
                   │                      │
            PUBLISH│  ┌────────────────┐  │SUBSCRIBE
                   └─▶│ Redis Pub/Sub  │──┘
                      │ "chat:messages"│
                      └────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │   MongoDB    │  messages · chats · users · inbox
            └──────────────┘
```

One HTTP server serves both protocols on one port: a request carrying
`Upgrade: websocket` goes to `ws`, everything else to Express.

Each instance holds a `Map<userId, WebSocket>` of **only its own** connections. No
instance knows where any other instance's users are, and that is the design — not a gap.

### The life of one message

```
 1. alice's browser    ws.send({ chatId, body })
 2. instance A         verify alice is a participant of chatId       (Mongo)
 3. instance A         persist with a server-assigned timestamp      (Mongo)
 4. instance A         write one inbox note per participant          (Mongo)
 5. instance A         PUBLISH to "chat:messages"                    (Redis)
 6. every instance     SUBSCRIBE fires on all of them
 7. each instance      for each participant it holds: send, then delete that inbox note
 8. bob's browser      onmessage → appended to state → re-render
```

Four things in that sequence are deliberate:

**`senderId` never comes from the client.** It's taken from the JWT verified during the
handshake. A client can lie about `chatId` and `body`; it cannot lie about who it is. The
throwaway test harness used during development had a "spoof senderId" checkbox
specifically to prove the field is ignored.

**The timestamp is assigned by the server, in step 3.** Ordering with multiple writers
normally needs synchronized clocks and sequence-gap detection. One authoritative clock per
message makes ordering trivially correct instead.

**Steps 4 and 5 are in that order, and step 4 is awaited.** The inbox note is written
*before* the publish. Reverse them and a fast delivery in step 7 can try to delete a note
that doesn't exist yet, and the message is then stuck in the inbox forever — it would be
re-delivered on the recipient's next connect even though they already have it.

**Step 7 writes then deletes rather than checking first.** No single instance can know
whether a user is online *anywhere*, only whether it holds them. So every participant gets
a note optimistically, and whichever instance actually delivers tears its note up. What's
left over after the dust settles is exactly the set of undelivered messages.

---

## Why these choices

### Redis Pub/Sub, not Redis Streams

The companion project used Streams; this one deliberately doesn't.

Streams persist, replay, and track per-consumer offsets. That's correct when a consumer
may be down and must catch up later — AdClick's aggregation worker, exactly. Pub/Sub is
fire-and-forget: no persistence, no replay, delivered only to whoever is subscribed right
now.

For live chat delivery, fire-and-forget is the *right* semantic. A message that arrives
for a socket nobody is holding has nowhere to go — and durability for that case is already
handled one layer down, by the inbox in Mongo. Using Streams here would mean paying for
persistence twice and then having to reason about offsets that no instance needs.

### One channel, not one per chat

Every message in the system goes through a single channel, `chat:messages`. Every instance
receives every message and drops the ones it holds no participant for.

Per-chat channels sound more efficient and are worse at this scale: an instance would have
to `SUBSCRIBE`/`UNSUBSCRIBE` on every connect, disconnect and chat creation, which means
tracking which chats each instance currently cares about — the beginnings of the service
discovery the whole design is trying to avoid. One channel means an instance's Redis
subscription never changes.

The trade-off is real and worth naming: every instance sees traffic for chats it doesn't
serve, so fan-out cost grows with instance count. The fix at scale is partitioned
channels (`chat:shard:{n}`, hash the chatId), which is a pure optimization on top of this
shape rather than a redesign.

### Redis as a rendezvous point, not a router

Redis doesn't know which instance holds which user, and never looks it up. An instance
publishes to a name; whoever is listening hears it. That's what eliminates the service
registry — the HelloInterview design's consistent hashing plus ZooKeeper exists to answer
"which server holds this user," and a shared channel makes the question unnecessary.

### `ws`, not Socket.IO

Socket.IO would supply heartbeat, reconnect, and a Redis adapter out of the box. Those are
three of the things this project exists to understand, so they're written by hand or
consciously skipped.

### Mongo, not Postgres

Messages are self-contained documents with no joins, written once and never updated — the
shape document stores are actually good at. The access pattern is almost entirely "the
last N messages in this chat, newest first," which one compound index serves exactly.

### Two Redis connections

A connection that has run `SUBSCRIBE` is in subscriber mode and can't run other commands,
so publishing on it fails. `bus.ts` opens one to publish with and one to listen on.

### Stateless JWTs

The server stores no sessions, so any instance can verify any token with no shared lookup.
The cost is that a token **cannot be revoked** before it expires — a valid token keeps
working after the account it names is deleted. The production answer is short-lived access
tokens (10–15 min) plus a server-side refresh token, which buys revocability back at the
price of a session store.

---

## Data model

| Collection | Fields | Index |
|---|---|---|
| `users` | `username` (unique, lowercased), `passwordHash` | unique on `username` |
| `chats` | `participantIds[]` (≥ 2, validated) | `{ participantIds: 1 }` |
| `messages` | `chatId`, `senderId`, `body` (≤ 4000), `serverTimestamp` | `{ chatId: 1, serverTimestamp: -1 }` |
| `inbox` | `userId`, `messageId` | `{ userId: 1, createdAt: 1 }` + TTL on `createdAt`, 7 days |

The message index is compound and descending to match the only query that runs against
it — `find({ chatId }).sort({ serverTimestamp: -1 }).limit(n)` — so it serves the filter
*and* the sort from one index scan with no in-memory sort step.

The TTL index is separate and single-field because Mongo only supports TTL on a
single-field index. It sweeps notes nobody ever collected, so a user who never returns
doesn't leave rows behind forever.

`Chat` has no `type` field on purpose: 1:1 versus group is `participantIds.length`.
Group delivery already works — a three-participant chat fans out to all three with no
code change — only a chat-creation endpoint is missing.

## API

| | |
|---|---|
| `GET /health` | `{ ok: true }` — not rate limited; the platform polls it |
| `POST /register` | bcrypt cost 10, stores only the hash |
| `POST /login` | returns a JWT, 7-day expiry |
| `GET /chats` | chats you participate in |
| `GET /chats/:id/messages` | history, newest first, `?limit` capped at 100 |
| `WS /?token=…` | the chat socket |

HTTP reads the token from `Authorization: Bearer`. The WebSocket reads it from the query
string, because a browser's `WebSocket` constructor accepts only a URL and cannot set
headers. `verifyToken` is shared; there's one reader per transport.

`POST /register` and `POST /login` are rate limited to 30 per 15 minutes per IP, counted
in **Redis rather than process memory** — in-memory counters would let two instances each
allow the full limit, and would reset on every deploy. The app also sets
`trust proxy = 1`, without which every request appears to come from Railway's proxy and
all users share one bucket.

---

## Deliberately not built

Each of these is a decision, not an omission.

| Cut | Why | What I'd do instead |
|---|---|---|
| **Delivery ACKs** | `socket.send()` only means "handed to the OS," so a client that disconnects mid-flush loses messages | Client ACKs the message id; the server deletes the inbox note on ACK rather than on send. This is also what delivery receipts fall out of |
| **Heartbeat ping/pong** | A half-open TCP connection stays in the `connections` Map until the OS notices | `ws`'s ping/pong on a 30s interval, terminate on a missed pong |
| **Presence / last-seen** | Needs a correct heartbeat first, or it reports stale state | Redis set of online user ids + a `last_seen` hash, updated on connect/disconnect |
| **Token revocation** | Stateless JWTs can't be invalidated before `exp` | Short-lived access token + server-side refresh token |
| **WS token in the query string** | Browsers cannot set handshake headers, and URLs land in access logs | Fetch a short-lived single-use ticket over HTTP, spend it on the socket connect |
| **Multi-device** | Inbox is per-user, and `connections` holds one socket per user, so a second login displaces the first | Per-device rows and a `Map<userId, Set<WebSocket>>` |
| **Consistent hashing + server registry** | Pub/Sub routes correctly without knowing where anyone is — the biggest cut and the right one | Only needed when per-instance fan-out cost dominates; partition channels first |
| **Attachments** | Text-only v1 | S3 pre-signed upload URLs; metadata in the message document |
| **Automated tests** | Every slice was verified by hand against a real stack | Vitest, with testcontainers for Mongo and Redis |
| **Registration UI** | The demo needs two accounts in one click, not a signup funnel | The endpoint exists and is rate limited; it just has no form |

### Known rough edges

- A page refresh keeps you logged in (`localStorage`), which means a script-injection bug
  could exfiltrate the token. There's no injection path today — React escapes rendered
  text and nothing uses `dangerouslySetInnerHTML` — but an `HttpOnly` cookie is the
  stronger answer.
- Loading chat history replaces client state rather than merging, so a message arriving
  during that fetch can briefly appear twice.
- Switching chats refetches history each time; there's no client-side cache.

---

## Running locally

### Prerequisites

- **Node 24** (Krypton LTS), pinned in `.nvmrc` and enforced by `engines`. Node is
  lazy-loaded via nvm on this machine, so every new shell needs:
  ```bash
  source ~/.nvm/nvm.sh && nvm use      # nvm use reads .nvmrc
  ```
  A Homebrew Node 21 is also installed and is what a bare shell gets. Always `nvm use` in
  this directory.
- **Colima** — this machine uses Colima, not Docker Desktop. It runs the Linux VM that
  provides the Docker daemon; the standard `docker` / `docker compose` CLIs work unchanged
  against it.
  ```bash
  colima status
  colima start      # once per reboot
  ```

### First-time setup

```bash
source ~/.nvm/nvm.sh && nvm use
npm install
cp .env.example .env
cd frontend && npm install && cd ..
```

### Three terminals

**1 — infrastructure** (Mongo + Redis in containers):

```bash
colima start                  # only if `colima status` says stopped
docker compose up -d
docker compose ps             # both should be healthy
```

**2 — backend** (runs on the host, not in Docker, so reload is instant):

```bash
source ~/.nvm/nvm.sh && nvm use
npm run seed                  # creates alice, bob, carol — all password hunter2pw
npm run dev
```

A good boot prints exactly three lines:

```
[mongo] connected
[redis] connected (pub + sub)
[ws] server listening on 8080
```

**3 — frontend:**

```bash
cd frontend
source ~/.nvm/nvm.sh && nvm use
npm run dev                   # Vite on http://localhost:5173
```

`nvm use` is not optional here — Vite 8 hard-fails on Node 21 with an
`ERR_INVALID_ARG_VALUE` thrown from inside rolldown.

Then two tabs on `localhost:5173`: alice in one, bob in the other, same chat, type.

### Seeing the Redis backplane

Run two backends and a frontend pointed at each:

```bash
PORT=8101 npm run dev     # terminal A
PORT=8102 npm run dev     # terminal B

cd frontend
VITE_API_URL=http://localhost:8101 npm run dev -- --port 5173
VITE_API_URL=http://localhost:8102 npm run dev -- --port 5174
```

Log in as alice on 5173 and bob on 5174, same chat. The message crosses even though their
sockets are held by different processes. Neither instance knows where the other's clients
are; they publish to a channel and each delivers to whoever it happens to hold.

### Verifying persistence directly

```bash
docker exec -it chatrooms-mongo mongosh chatrooms --eval "db.messages.find().pretty()"
```

The collection is `messages` — Mongoose lowercases and pluralizes the model name
`Message`.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | dev server, auto-restart on save |
| `npm run typecheck` | types only, no build — fastest feedback loop |
| `npm run build` | compile TS to `dist/` |
| `npm start` | run the compiled build |
| `npm run seed` | wipe and recreate alice, bob, carol and a chat |
| `npm run peek` | print stored messages, newest first |
| `docker compose up -d` | start Mongo + Redis |
| `docker compose down` | stop them (data survives) |
| `docker compose down -v` | stop and **wipe** the data |

`npm run seed` refuses any non-localhost `MONGO_URL` unless `-- --yes` is passed, because
it opens with three unguarded `deleteMany({})` calls. It always prints the host and
database it is about to empty.

## Environment

| Variable | Purpose |
|---|---|
| `PORT` | injected by the platform in production; defaults to 8080 |
| `MONGO_URL` | include the database name before the `?`, or Mongoose writes to `test` |
| `REDIS_URL` | pub/sub **and** the rate-limit store |
| `JWT_SECRET` | signs and verifies tokens; anyone holding it can mint a token for any user |
| `CORS_ORIGINS` | comma-separated allowlist. **No trailing slash** — a browser's `Origin` header never has one, so a mismatch blocks every response |
| `VITE_API_URL` | frontend only, and **substituted at build time** — changing it needs a rebuild, not a restart. The WebSocket URL is derived from it (`https` → `wss`) |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `command not found: npm` | `source ~/.nvm/nvm.sh` first |
| `ERR_INVALID_ARG_VALUE` from rolldown | wrong Node — `nvm use` |
| `Cannot find name 'console'` / `'process'` | `npm install` hasn't run |
| `ECONNREFUSED ::1:27017` | Mongo isn't up — `docker compose up -d` |
| `Cannot connect to the Docker daemon` | Colima is stopped — `colima start` |
| `EADDRINUSE` on 8080 | an old `npm run dev` is alive — `lsof -ti:8080 \| xargs kill` |
| `CastError` in server logs | `chatId` wasn't valid 24-char hex — expected behaviour |
| "could not reach the server" in the UI | backend isn't running, **or** CORS. The console tells you which: `ERR_CONNECTION_REFUSED` vs `blocked by CORS policy` |
| Writes "succeed" but the container DB is empty | **a native daemon owns the port.** A Homebrew `mongod` on `127.0.0.1:27017` beats Colima's `*:27017` forward, so `localhost` reaches it instead of the container. Check with `lsof -nP -iTCP:27017 -sTCP:LISTEN`. Disabled 2026-09-08 via `launchctl bootout` + `disable`; the same trap applies to Redis on 6379 |

## Layout

```
docker-compose.yml   Mongo + Redis only; the app runs on the host
src/
├── config.ts        env read once, validated at boot — a missing var is a boot crash
├── db.ts            Mongo connection lifecycle
├── bus.ts           the two Redis connections + the channel payload type
├── models/          one Mongoose schema per collection
├── scripts/seed.ts  creates alice, bob, carol and a chat
└── index.ts         Express routes + the WebSocket server
frontend/
└── src/App.tsx      LoginForm · ChatList · MessageList · Composer · App
```

`DESIGN.md` has the full KEEP / SIMPLIFY / CUT scoping. The git history is one commit per
concept, and the branch names map to them — including `slice-2-routing`, parked where a
slice that tried to do six things at once was rolled back.
