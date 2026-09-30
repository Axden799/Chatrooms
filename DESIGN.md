# Chatrooms — Design & Scoping

> **Read this first.** This is the design handoff from the planning session (done in the
> AdClickAggregator repo's Claude session). It captures every decision made so far so a
> fresh session picks up exactly where we left off. When you finish reading, resolve the
> **two open decisions** at the bottom, then cut the first thin vertical slice.

## What this is

A real-time group chat backend (WhatsApp-lite) — **portfolio project #2** for Denis's
backend-engineer job search. It is the deliberate complement to his first project,
**AdClickAggregator** (FastAPI + Redis Streams + Postgres, high-throughput ad-click
ingestion — DONE and deployed on Railway/Vercel).

**Why chat, why this stack:** AdClick trained *high-throughput ingestion + aggregation*
(request/response, fire-and-forget, eventual rollup). Chat trains the **opposite** muscle
set that Denis is missing and that interviews probe: **persistent bidirectional connections
(WebSockets), real-time fan-out, message ordering/delivery, and stateful-server scaling.**
It's also the vehicle for closing his biggest market gaps — **Node.js + TypeScript** (his
firsthand posting scan: Node ≈ Go > Python; heavy TS ask even for backend) and **MongoDB**
(the dominant NoSQL request).

Based on the HelloInterview WhatsApp system-design breakdown:
https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp

## Stack

| Layer | Choice | New or reused |
|---|---|---|
| Language/runtime | **Node.js + TypeScript** | NEW (the big growth surface) |
| Real-time transport | **WebSockets** via **`ws`** (decided 2026-09-01) | NEW |
| Cross-server routing | **Redis Pub/Sub** backplane | NEW structure, reused tool |
| Presence / last-seen | **Redis** (connected-user set + timestamps) | reused tool |
| Persistence | **MongoDB + Mongoose** (ODM gives schemas + TS types) | NEW |
| Frontend | **React** (Vite) | reused |
| Containerization | **Docker / Docker Compose** | reused |
| Deploy — phase 1 | **Railway (backend) + Vercel (frontend)** | reused |
| Deploy — phase 2 (later) | **AWS** (ECS Fargate + DocumentDB/Atlas + ElastiCache + ALB + S3/CloudFront) — doubles as hands-on AWS SAA prep | NEW, deferred |

**Balance target:** ~40% new / 60% reinforcement — same ratio that worked on AdClick.
Reused so Denis doesn't forget: Redis, Docker, Railway/Vercel, React, API design, TTL
retention, testing, config/env. New: WebSockets, Redis Pub/Sub, Node/TS, Mongo/Mongoose,
presence, the inbox/offline pattern, WS auth.

## Scope: KEEP / SIMPLIFY / CUT

Same philosophy as AdClick: keep what teaches a system-design muscle; cut the
"scale-to-billions" infrastructure that adds complexity but no new learning at portfolio
scale. **Every cut is an interview talking point** ("here's what I'd add for production").

### KEEP — the teaching core
- **WebSocket chat servers** — the entire new skill; the point of the project.
- **Redis Pub/Sub backplane** — marquee talking point: "how do two users on *different*
  server instances exchange a message?" Build it even running one instance; demo with
  `docker compose --scale`.
- **Inbox pattern** — per-recipient undelivered queue, cleared on client ACK. Teaches
  durability + **offline delivery**. Natural Mongo fit.
- **Message persistence / history** — chat history in Mongo (documents are the perfect shape).
- **Chats + participants** — 1:1 AND small groups (group fan-out: resolve participants →
  deliver to each).
- **Presence** (online / last-seen) — cheap, Redis-native.
- **Delivery receipts** (sent → delivered) — falls out of the ACK you already need to clear
  the inbox. Read receipts = optional stretch.
- **Retention TTL** on inbox/messages — reuses AdClick's TTL skill (Mongo TTL index).
- **Heartbeat ping/pong** — detect dead connections so presence stays correct. Basic version.
- **Lightweight auth** — just enough for real distinct users AND to authenticate the
  **WebSocket handshake** (WS auth is genuinely new). NOT a full email-verify flow (Denis
  already built that in api_project — no new learning there).

### SIMPLIFY
| Their version | Our version | Why |
|---|---|---|
| Ordering via NTP-synced multi-server clocks + sequence-number gap detection | Single authoritative **server timestamp** | One logical clock ⇒ ordering trivially correct. Seq-number gap detection = optional stretch + talking point. |
| Group membership with GSI reverse-lookup | Plain Mongo membership query | Not at billions; a query is fine. |
| Fleet via consistent hashing | Architect *with* pub/sub so it *would* scale; run 1–2 instances | Scaling story without the routing machinery. |

### CUT — all "scale to billions"/side-concerns → talking-point bank
- **Consistent hashing + ZooKeeper/Etcd server registry** — pub/sub alone routes correctly
  at our scale. Biggest cut, and the right one.
- **DynamoDB partitioning / L4 LB / 100K writes-sec engineering** — pure scale.
- **Adaptive pub/sub partitioning** (chat-level channels for huge groups) — scale optimization.
- **Multi-device per user** (Clients table, per-client inbox) — assume one device; inbox stays
  per-*user*.
- **Media / attachments** (S3 pre-signed URLs) — text-only v1. Flag loudly: *fantastic* later
  stretch because it teaches **S3 pre-signed uploads** — perfect for the AWS phase.
- **Polling fallback + advanced pub/sub-failure resilience** — production hardening.
- **Comprehensive security / spam** — out of scope in their article too.

## Target demo (definition of done for v1)

Open two browser windows, log in as two users → each sees the other **online** → create a
1:1 (or group) chat → messages deliver in **real time (<500ms)** → close one window and
send → messages **queue in the inbox and deliver on reconnect** → history persists →
last-seen shows when they went offline.

## Core entities (Mongo collections) — draft, refine in slice 1
- **User** — { _id, username, token/credential }
- **Chat** — { _id, type: '1:1'|'group', participantIds[], createdAt }
- **Message** — { _id, chatId, senderId, body, serverTimestamp } (own collection, NOT
  embedded in Chat — messages are unbounded and would blow Mongo's 16MB doc limit; that
  embed-vs-reference reasoning is itself an interview talking point)
- **Inbox** — per-recipient undelivered messages, TTL index for retention
- **Presence** — lives in Redis, not Mongo (connected-user set + last-seen timestamps)

## The working agreement (HOW to collaborate — do not skip)

This governs every session, carried over from AdClick. Denis is learning; the goal is that
he keeps the learning, not just that code ships.

1. **Design decisions are Denis's.** Present options + a recommendation; he decides. Don't
   unilaterally pick architecture.
2. **Plan before code.** Talk through the approach before writing.
3. **Split every slice into "learning surface" vs "boilerplate."** Denis writes the core
   logic (the new concept); Claude scaffolds the boilerplate. For this project, because
   Node/TS is new-at-once, lean harder on Claude scaffolding TS *plumbing* (tsconfig, types,
   project setup) and keep Denis's learning-surface on the *concepts* (WebSockets, pub/sub
   fan-out, message ordering, inbox).
4. **"Explain it back."** Nothing enters the repo Denis can't explain.
5. **One thin vertical slice at a time.** Denis runs each himself in his own terminal and
   verifies before moving on.
6. **Answer "why," not just "how."** Denis asks for deep explanations and analogies; he's
   strong on comprehension, weaker on productive recall (writing from scratch) — so writing
   reps matter more than reading. He knows Python well; map TS/Node idioms back to Python
   (Pydantic ≈ TS interfaces, `async/await` transfers directly).

## Two decisions — RESOLVED 2026-09-01

1. **Groups from the start, or 1:1 first then add groups?**
   **DECIDED: 1:1 first.** Get real-time delivery working end-to-end for two users, *then*
   generalize the fan-out to N recipients as a later slice. Groups aren't much extra once
   single-recipient delivery is proven.

2. **How much auth?**
   **DECIDED: lightweight.** Pick a username → get a userId + a simple token passed on the
   WebSocket handshake. Enough for real distinct users and to learn WS handshake auth — the
   genuinely new part — and nothing more. A fuller login reuses api_project ground and adds
   no new learning.

## Deferred work — pick up before calling v1 done

Things consciously postponed to keep a slice thin. Each is a real gap, not a cut.

| # | Item | Deferred at | Why it was deferred | What it needs |
|---|---|---|---|---|
| 1 | **Real `User` records + login** | slice 2 (2026-09-09) | Slice 2 is about the connection registry and routing. A `User` model plus a `POST /login` endpoint would force restructuring the server to serve HTTP and WebSocket on one port (`http.createServer` + `WebSocketServer({ server })`) — real work, orthogonal to what the slice teaches. | `models/User.ts` (username → userId + token), an HTTP login endpoint, and a token check in the WS handshake. Structural win is already in place: `senderId` comes from the connection, not the payload — so this only touches the handshake. |
| 2 | **Token verification on the handshake** | slice 2 (2026-09-09) | Follows item 1 — without `User` records there is no token to verify. Today any client may claim any `userId` in the query string. | Verify the token at the upgrade request; close with code 1008 on failure. **Note:** `ws` fires `connection` only AFTER the 101 handshake is already sent, so `socket.close(1008)` there is a post-handshake close — the client observes `open` then immediately `close`. To reject before the 101, use the `verifyClient` option or handle the server's raw `upgrade` event. Fine for slice 2; do it properly when the token check lands. |

## Suggested first vertical slice (to propose after the two decisions)
The thinnest end-to-end thread: **one client connects over a WebSocket, sends a message,
the server timestamps + persists it to Mongo and echoes it back.** No pub/sub, no inbox, no
presence yet — just prove the WS + Mongo + TS toolchain works end to end. Then layer in
pub/sub (two clients), then inbox (offline), then presence, then groups.
