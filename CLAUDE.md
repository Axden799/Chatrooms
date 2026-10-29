# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## First action for a fresh session

**Read `DESIGN.md`** — it holds the full scoping (KEEP/SIMPLIFY/CUT), stack decisions, and
the working agreement. This file is the quick reference; `DESIGN.md` is the source of truth
for scope.

**Decided (2026-09-01):** 1:1 chat first, generalize to groups in a later slice ·
lightweight auth (username → userId + token on the WS handshake), not a full login flow.

**Repo state: SHIPPED and deployed (2026-10-29).** Frontend
https://chatrooms-mu.vercel.app · backend
https://chatrooms-production-e166.up.railway.app · repo
https://github.com/Axden799/Chatrooms. Vercel + Railway (app + Redis in ONE Railway
project) + Mongo Atlas. Verified in production end to end: `wss://` through Railway's
proxy, alice→bob in ~350ms, sender receives their own message back, inbox flush after a
disconnect, participant check rejecting a non-member, rate-limit counters in Redis.

Every slice is complete. In order: **1** WS → server timestamp → Mongo → echo · **2**
identity from the handshake query string, so `senderId` cannot be spoofed · **3** a
`Map<userId, WebSocket>` registry · **4** a `Chat` model with `participantIds` gating
send and receive · **5** the Redis Pub/Sub backplane — publish instead of deliver, and a
subscribe callback on every instance delivers to the participants it holds · **6** one
HTTP server owns the port, `ws` attaches to it · **7a** Express + `express.json()` +
`GET /health` · **7b** `User` model and `POST /register`, bcrypt cost 10 · **7c**
`POST /login` returning a 7-day JWT, with an identical 401 for wrong password and unknown
username so accounts cannot be enumerated · **8** the handshake verifies `?token=` with
`jwt.verify`; `?userId=` no longer works · **9** the inbox — a note per participant
written before the publish, torn up by whichever instance delivers, the remainder flushed
on next connect, 7-day TTL · **10** `GET /chats/:id/messages`, participant-gated,
newest-first, capped limit; `verifyToken` plus a reader per transport · **11-0**
`GET /chats` + CORS allowlist · **11a–11i** the React frontend, one concept per slice
(render model, `useState`, async handlers, `useEffect`, props and lifted state, cleanup
and stale closures, `useRef`, sending, then rate limiting and demo logins) · **12** deploy
and this documentation.

**Hard-won details worth not rediscovering:**
- `CORS_ORIGINS` must have **no trailing slash**. A browser's `Origin` header never has
  one, so `https://host/` silently matches nothing and blocks every response. Cost an hour.
- `MONGO_URL` needs the database name before the `?` or Mongoose writes to `test`. The
  seed script now prints the target database for exactly this reason.
- `app.set("trust proxy", 1)` is required behind Railway, or every request looks like it
  came from the proxy and all users share one rate-limit bucket. `1`, not `true` —
  `true` reads the client-controlled leftmost `X-Forwarded-For` entry.
- The rate limiter uses the **Redis** store, not the default in-memory one, because
  in-process counters contradict the whole multi-instance premise.
- Never set `NODE_ENV=production` on Railway: `npm ci` then skips devDependencies and
  `npm run build` fails with `tsc: not found`.
- Railway variables only take effect on a **new deployment**.
- `npm run seed` refuses a non-localhost `MONGO_URL` without `-- --yes`; it opens with
  three unguarded `deleteMany({})`.

**Deliberately CUT from v1, each documented in README with what I'd do instead:** delivery
ACKs, heartbeat ping/pong, presence/last-seen, token revocation, the WS-ticket fix for the
token-in-URL problem, multi-device, consistent hashing + server registry, attachments,
automated tests, a registration UI. Groups already work — a 3-participant chat fans out to
all three with no code change; only a creation endpoint is missing. `Chat` has no `type`
field on purpose, since 1:1 vs group is `participantIds.length`.

**Optional next, in rough order of value:** automated tests (Vitest + testcontainers, its
own slice, never bundled into a feature slice) · delivery ACKs, which also give you
delivery receipts · heartbeat, then presence on top of it · a chat-creation endpoint to
make groups reachable from the UI · the AWS redeploy that `DESIGN.md` lists as the phase-2
stretch and SAA prep.

**Slices are ONE concept each** — re-cut on 2026-09-30 after a first attempt at slice 2
bundled six concepts and had to be rolled back (parked at `84aa8f1` on
`slice-2-routing`). All 21 branches are pushed, so the history is browsable per concept.

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
- **React (Vite)** — frontend. **A primary learning surface, NOT reinforcement** (revised
  2026-10-17): Denis does not retain React from earlier tutorials and is targeting
  full-stack roles. Teach it piece by piece — slice 11 is split into eight. The big jump is
  the render model: a component function runs again on every state change, unlike a server
  handler that runs once per event. See DESIGN.md.
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

**No test runner.** Every slice was verified by hand against a real stack, and the project
shipped that way — see the cut list in `README.md`. If tests get added, Vitest plus
testcontainers for Mongo and Redis, as its own slice, never bundled into a feature slice.

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
