# Chatrooms

Real-time chat backend — WebSockets + Redis Pub/Sub + MongoDB. Portfolio project #2.
See `DESIGN.md` for scope and architecture decisions.

## Prerequisites

- **Node** — lazy-loaded via nvm on this machine, so every new shell needs:
  ```bash
  source ~/.nvm/nvm.sh
  ```
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

Two terminals.

**Terminal 1 — infrastructure** (Mongo + Redis in containers):

```bash
colima start                  # only if `colima status` says stopped
docker compose up -d          # start, detached
docker compose ps             # confirm both are healthy
```

**Terminal 2 — the app** (runs on the host, not in Docker, so reload is instant):

```bash
source ~/.nvm/nvm.sh
npm run dev                   # tsx watch — restarts on save
```

Expected output:

```
[mongo] connected
[ws] listening on ws://localhost:8080
```

**Then open the test client:**

```bash
open public/client.html
```

Type a message, hit Send. You should see a `sent` line, then a `recv` line coming back
with an `_id` and a `serverTimestamp` the server added.

## Verifying it actually persisted

An echo alone doesn't prove the write happened. Check Mongo directly:

```bash
docker exec -it chatrooms-mongo mongosh chatrooms --eval "db.messages.find().pretty()"
```

The collection is `messages` — Mongoose lowercases and pluralizes the model name `Message`.

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
public/client.html   throwaway test harness — replaced by React later
src/
├── config.ts        env read once, validated at boot
├── db.ts            Mongo connection lifecycle
├── models/          one Mongoose schema per collection
└── index.ts         entry point — WebSocket server
```
