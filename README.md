# Chatrooms

Real-time chat backend — WebSockets + Redis Pub/Sub + MongoDB. Portfolio project #2.
See `DESIGN.md` for scope and architecture decisions.

## Prerequisites

- **Node 24** (Krypton LTS), pinned in `.nvmrc` and enforced by `engines` in
  `package.json`. Node is lazy-loaded via nvm on this machine, so every new shell needs:
  ```bash
  load_nvm      # or: source ~/.nvm/nvm.sh
  nvm use       # reads .nvmrc
  ```
  Note a Homebrew Node (v21, never an LTS) is also installed and is what a bare shell
  gets. Always `nvm use` in this directory so you are on 24.
- **Colima** — this machine uses Colima (free, open-source), NOT Docker Desktop. It runs a
  Linux VM that provides the Docker daemon; the standard `docker` / `docker compose` CLIs
  then work unchanged against it.
  ```bash
  colima status     # check
  colima start      # start the VM — needed once per reboot
  ```

## First-time setup

```bash
source ~/.nvm/nvm.sh
npm install
cp .env.example .env
```

## Running

Three terminals.

**Terminal 1 — infrastructure** (Mongo + Redis in containers):

```bash
colima start                  # only if `colima status` says stopped
docker compose up -d          # start, detached
docker compose ps             # confirm both are healthy
```

**Terminal 2 — the backend** (runs on the host, not in Docker, so reload is instant):

```bash
source ~/.nvm/nvm.sh && nvm use
npm run seed                  # creates alice, bob, carol — all password hunter2pw
npm run dev                   # tsx watch — restarts on save
```

Expected output:

```
[mongo] connected
[redis] connected (pub + sub)
[ws] listening on ws://localhost:8080
```

**Terminal 3 — the frontend:**

```bash
cd frontend
source ~/.nvm/nvm.sh && nvm use
npm run dev                   # Vite on http://localhost:5173
```

`nvm use` is not optional here — Vite 8 hard-fails on the Homebrew Node 21 with an
`ERR_INVALID_ARG_VALUE` from inside rolldown.

Open two browser tabs on `localhost:5173`. Click **log in as alice** in one and **log in
as bob** in the other, pick the same chat in both, and type. The message appears in both
lists with no refresh.

## Verifying it actually persisted

An echo alone doesn't prove the write happened. Check Mongo directly:

```bash
docker exec -it chatrooms-mongo mongosh chatrooms --eval "db.messages.find().pretty()"
```

The collection is `messages` — Mongoose lowercases and pluralizes the model name `Message`.

## Running two instances (the Redis backplane)

Slice 5 made instances able to reach each other's clients. To see it, run two:

```bash
npm run seed
PORT=8101 npm run dev     # terminal 1
PORT=8102 npm run dev     # terminal 2
```

Both should log `[redis] connected (pub + sub)`. Then run two frontends, each pointed at
a different backend:

```bash
cd frontend
VITE_API_URL=http://localhost:8101 npm run dev -- --port 5173
VITE_API_URL=http://localhost:8102 npm run dev -- --port 5174
```

Log in as alice on `5173` and bob on `5174`, same chat. A message from alice reaches bob
even though their sockets are held by separate processes — that is the Redis backplane
doing its job. Neither instance knows where the other's clients are; they publish to a
channel and every instance delivers to whoever it happens to hold.

## All commands

| Command | Purpose |
|---|---|
| `npm run dev` | dev server, auto-restart on save |
| `npm run typecheck` | types only, no build — fastest feedback loop |
| `npm run build` | compile TS to `dist/` |
| `npm start` | run the compiled build |
| `npm run peek` | print stored messages, newest first (sender + body) |
| `docker compose up -d` | start Mongo + Redis |
| `docker compose down` | stop them (data survives) |
| `docker compose down -v` | stop and **wipe** the data |
| `docker compose logs -f mongo` | tail a container's logs |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `command not found: npm` | `source ~/.nvm/nvm.sh` first |
| `Cannot find name 'console'` / `'process'` | `npm install` hasn't run — missing `@types/node` |
| `ECONNREFUSED ::1:27017` | Mongo isn't up — `docker compose up -d` |
| `Cannot connect to the Docker daemon` | Colima VM is stopped — run `colima start` |
| Client shows "socket error" | server isn't running, or not on port 8080 |
| `CastError` in server logs | `chatId`/`senderId` wasn't valid 24-char hex — expected behavior |
| `EADDRINUSE` on 8080 | an old `npm run dev` is still alive — `lsof -ti:8080 \| xargs kill` |
| Writes "succeed" but the container DB is empty | **a native daemon owns the port.** A Homebrew `mongod` on `127.0.0.1:27017` beats Colima's `*:27017` forward, so `localhost` reaches it instead of the container. Check with `lsof -nP -iTCP:27017 -sTCP:LISTEN`. Disabled on 2026-09-08 via `launchctl bootout` + `disable`; the same trap applies to Redis on 6379. |

## Project layout

```
docker-compose.yml   Mongo + Redis only; the app runs on the host
src/
├── config.ts        env read once, validated at boot
├── db.ts            Mongo connection lifecycle
├── bus.ts           Redis pub/sub connections + the channel payload type
├── models/          one Mongoose schema per collection
├── scripts/seed.ts  creates alice, bob, carol and a chat
└── index.ts         entry point — Express routes + WebSocket server
frontend/
├── src/App.tsx      the whole UI: LoginForm, ChatList, MessageList, Composer, App
└── vite.config.ts
```
