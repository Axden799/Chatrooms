# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## First action for a fresh session

**Read `DESIGN.md`** — it holds the full scoping (KEEP/SIMPLIFY/CUT), stack decisions, and
the working agreement. This file is the quick reference; `DESIGN.md` is the source of truth
for scope.

**Decided (2026-09-01):** 1:1 chat first, generalize to groups in a later slice ·
lightweight auth (username → userId + token on the WS handshake), not a full login flow.

**Repo state:** slice 3 complete. Slice 1 = WS → server timestamp → Mongo → echo.
Slice 2 = identity read from the handshake query string (`?userId=`), so `senderId` comes
from the connection and a client can no longer spoof it. Slice 3 = a `Map<string, WebSocket>`
registry of connected users. Slice 4 = a `Chat` model with `participantIds`; membership
gates both sending and receiving, so `chatId` is now meaningful. Slice 5 = a Redis Pub/Sub
backplane: the message handler publishes instead of delivering, and a subscribe callback on
every instance delivers to the participants it holds — so two instances can reach each
other's clients. Slice 6 = an HTTP server owns the port and the
WebSocket server attaches to it, so one port serves both protocols. Slice 7a = Express
handles the HTTP side (routing + `express.json()` body parsing); `GET /health` returns
`{"ok":true}` and Slice 7b = a `User` model
(`username` unique + lowercased, `passwordHash`) and `POST /register`, which bcrypt-hashes
the password at cost 10 and stores only the hash. Slice 7c = `POST /login`, which verifies
with `bcrypt.compare` and returns a JWT signed with `JWT_SECRET` (7-day expiry); the same
401 is returned for a wrong password and an unknown username so the endpoint cannot be used
to enumerate accounts. Slice 8 = the WebSocket handshake takes `?token=` and verifies it
with `jwt.verify`, so `?userId=` no longer works at all; `senderId` now comes from a signed
claim rather than a client assertion. Slice 9 = the inbox: a note row per
participant is written when a message is sent, torn up by whichever instance delivers it,
and whatever remains is flushed to that user on their next connect — so offline delivery
works, and works across instances because the inbox lives in Mongo rather than process
memory. A 7-day TTL index sweeps notes nobody collected. `npm run seed` creates real
accounts (alice, bob in a chat; carol outside it — all password `hunter2pw`). `npm run seed` creates a chat and prints ids for test tabs.
Running Node 24. No remote yet.

**Slices are ONE concept each** — this was re-cut on 2026-09-30 after a first attempt at
slice 2 bundled six concepts and had to be rolled back (parked at `84aa8f1` on
`slice-2-routing`). Remaining to SHIP (agreed 2026-10-16): slice 10 = a history
endpoint (`GET /chats/:id/messages` — messages are persisted but unreadable, so a refresh
shows nothing); slice 11 = a minimal React UI; slice 12 = deploy to Railway/Vercel and
rewrite the README as the architecture story. Deliberately CUT from v1: presence/last-seen,
groups (a chat with 3+ participants already works — only a creation endpoint is missing),
delivery receipts, heartbeat, deferred items 4 and 5. Then inbox
(offline delivery), presence, groups. Slices 7-8 close the deferred items 1-2 and are the
biggest real gap: today anyone who knows a userId can be that user, and userIds are
public (they appear in every message's `senderId`). See also "Deferred work" in DESIGN.md. `Chat` has no `type` field on purpose — derivable from
`participantIds.length`; add it when a group needs a name. Test tooling is its own slice, never bundled
into a feature slice.

## Project Purpose

**Chatrooms** — a real-time group chat backend (WhatsApp-lite), portfolio project #2 for
Denis's backend software-engineer job search. It is the deliberate complement to his first
project, **AdClickAggregator** (FastAPI + Redis Streams + Postgres, high-throughput
ad-click ingestion — done and deployed). Where AdClick trained high-throughput
ingestion/aggregation, Chatrooms trains **real-time bidirectional communication**:
WebSockets, Redis Pub/Sub fan-out, message ordering/delivery, and stateful-server scaling.

It also closes Denis's biggest market-demand gaps: **Node.js + TypeScript** and **MongoDB**
(from his firsthand job-posting scan — Node ≈ Go > Python, heavy TS, MongoDB the dominant
NoSQL ask).

Based on the HelloInterview WhatsApp breakdown:
https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp
(scoped down for portfolio scale — see `DESIGN.md`).

## Stack

- **Node.js + TypeScript** — the API + WebSocket server (NEW; the main growth surface)
- **WebSockets** via **`ws`** — persistent bidirectional real-time transport. Chosen over
  Socket.IO deliberately: Socket.IO would auto-provide heartbeat, reconnect, and the Redis
  Pub/Sub backplane, which are three of this project's stated learning goals. Write them by hand.
- **Redis Pub/Sub** — backplane routing messages between server instances (the marquee scaling story)
- **Redis** — presence (connected-user set) + last-seen timestamps
- **MongoDB + Mongoose** — persistence for users, chats, messages, inbox (NEW)
- **React (Vite)** — frontend (reused from prior projects)
- **Docker / Docker Compose** — multi-service local stack (reused)
- **Railway + Vercel** — phase-1 deploy (reused); **AWS** is the phase-2 stretch (doubles as SAA prep)

## Commands

**Node 24** (Krypton LTS), pinned in `.nvmrc` + `engines`. Node is lazy-loaded via nvm, so
a non-interactive shell needs `source ~/.nvm/nvm.sh && nvm use 24` first — a bare shell gets
the Homebrew Node 21 (never an LTS) instead, which is the wrong runtime.
Full instructions and a troubleshooting table live in `README.md`.

```bash
npm install
npm run dev          # tsx watch — dev server, restarts on save
npm run typecheck    # tsc --noEmit, fastest feedback loop
npm run build        # compile to dist/
docker compose up -d # Mongo + Redis (the app runs on the HOST, not in compose)
```

No test runner yet — vitest/jest still TBD, to be decided when the first slice needs tests.

Verify persistence directly (collection is `messages`, pluralized from the model name):

```bash
docker exec -it chatrooms-mongo mongosh chatrooms --eval "db.messages.find().pretty()"
```

## About Denis (collaboration context)

Denis Dutka — Software Engineer, Miami FL. BS Computer Engineering, FIU (Magna Cum Laude).
Ex-Cisco SWE II (Python automation / PyATS). **Primary language: Python**; also JS/C/C++.
Currently job-hunting for a backend role, applying ~10/week. **Strong on comprehension,
weaker on productive recall in JS/TS** (writing from scratch) — so favor writing reps and
map TS/Node idioms back to Python. GitHub: Axden799.

## The working agreement (HOW to work with Denis — do not skip)

The goal is that Denis *keeps the learning*, not just that code ships. Full version in
`DESIGN.md`; the short form:

1. **Design decisions are Denis's** — present options + a recommendation, he decides.
2. **Plan before code.**
3. **Split each slice into "learning surface" (Denis writes the core new concept) vs
   "boilerplate" (Claude scaffolds).** Node/TS is new-at-once, so Claude leans in on TS
   *plumbing* (setup, tsconfig, types) while Denis owns the *concepts* (WebSockets, pub/sub,
   inbox, ordering).
4. **"Explain it back"** — nothing enters the repo Denis can't explain.
5. **One thin vertical slice at a time** — Denis runs and verifies each himself before moving on.
6. **Answer "why," not just "how"** — deep explanations and analogies; he asks for these.

## Python-conventions note

Denis's other projects each own a `venv/`. This one is Node — no venv. Node tooling on his
machine is lazy-loaded via `load_nvm` in `.zshrc`; a non-interactive shell won't have `node`
/`npm` on PATH automatically, so source nvm or use an absolute path when running Node tools
from tool calls. (See `~/CLAUDE.md` and `~/Public/CLAUDE.md` for the workspace-wide setup.)
