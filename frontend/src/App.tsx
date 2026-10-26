import { useEffect, useRef, useState } from "react";

/**
 * Where the backend lives.
 *
 * import.meta.env is NOT a runtime lookup — there is no `process` in a browser, so Vite
 * replaces this text with the literal string at BUILD time. Consequences: changing it
 * needs a rebuild, and whatever is here ships inside the downloaded JavaScript. That is
 * why only VITE_-prefixed names are exposed — never put a secret here.
 */
const API = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

/**
 * The same server, addressed as a WebSocket.
 *
 * http -> ws and https -> wss, which the one replace handles because "https" starts
 * with "http". Deriving it rather than hardcoding matters for deployment: a page served
 * over HTTPS cannot open an insecure ws:// connection — browsers block it outright — so
 * production must be wss://.
 */
const WS = API.replace(/^http/, "ws");

/**
 * THE RENDER MODEL: a component function runs again, from the top, every time its
 * state changes. On the backend a handler runs once per event; here React re-runs the
 * whole function and compares what it returns to what is on screen. So the body is not
 * setup code — it is a description of the screen for the current state, re-evaluated.
 *
 * That is why a plain `let` cannot hold state: nothing would tell React to re-render,
 * and a module-level variable would be shared by every instance rather than per
 * component. useState stores the value outside the function and its setter triggers
 * the re-run.
 *
 * State is per component INSTANCE: typing in LoginForm re-runs only LoginForm, not
 * Counter. A controlled input is a loop — value={x} is React telling the input what to
 * show, onChange is the input telling React what changed — so every keystroke is a
 * round trip through state. An input with `value` and no `onChange` is read-only.
 */
// 

/**
 * Authenticates, and (for now, wrongly) also lists the user's chats — 11e splits these.
 *
 * The chat fetch is in a useEffect because the component body runs on EVERY render: a
 * fetch there would resolve, call setChats, trigger a render, and fetch again forever.
 * The [token] dependency means it re-runs when token goes from null to a value.
 *
 * The effect declares an inner async function rather than being async itself, because
 * useEffect reserves its return value for a cleanup function (see 11f).
 */
/** What GET /chats returns for each chat. */
type Chat = {
  _id: string;
  participantIds: string[];
  createdAt: string;
};

/** What GET /chats/:id/messages returns for each message. */
type Message = {
  _id: string;
  chatId: string;
  senderId: string;
  body: string;
  serverTimestamp: string;
};

function ChatList({ token, onSelect }: { token: string; onSelect: (id: string) => void }) {
  const [chats, setChats] = useState<Chat[]>([]);

  useEffect(() => {
    if (!token) return;
    async function load() {
      const res = await fetch(`${API}/chats`, {
        headers : { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (res.ok) setChats(data.chats);
    }

    load();
  }, [token]);

  return (
    <>
      {chats.length > 0 && (
        <ul>
          {chats.map((c) => (
            <li key={c._id}>
              <button onClick={() => onSelect(c._id)}>{c._id}</button>{c.participantIds.length} participants
            </li>
          ))}
        </ul>
      )}
    </>
  )}

function LoginForm({ onLogin }: { onLogin: (t: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");


  async function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok){
        setError(data.error ?? "login failed");
        return;
      }
      onLogin(data.token);
    } catch {
      setError("could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="card">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password" />
        <button type="submit" disabled={loading}>
          {loading ? "logging in..." : "log in"}
        </button>
        {error && <p style={{color: "#c00"}}>{error}</p>}
      </form>
    </>
  );
}

/**
 * Display only. No state, no fetching, no socket — it renders what it is handed.
 *
 * `messages` holds every message App has seen, across every chat, so the filter happens
 * HERE rather than in App's socket handler. Render-time code reads current props on every
 * render; a handler created inside an effect reads the values from the one run that
 * created it. Filtering in the handler would compare against a frozen chatId.
 *
 * Sorted rather than reversed: history arrives newest-first and live messages append to
 * the end, so a plain .reverse() puts the newest live message at the top. serverTimestamp
 * is an ISO-8601 string, and ISO-8601 sorts correctly as text, so comparing the strings
 * is the same as comparing the dates.
 */
function MessageList({ messages, chatId }: { messages: Message[]; chatId: string }) {
  const ordered = messages
    .filter((m) => m.chatId === chatId)
    .sort((a, b) => a.serverTimestamp.localeCompare(b.serverTimestamp));

  return (
    <ul className="card">
      {ordered.map((m) => (
        <li key={m._id}>
          <strong>{m.senderId.slice(-6)}</strong> {m.body}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  // Messages live here now, not in MessageList: 11h sends from a form, and the form and
  // the socket have to be reachable from the same place.
  const [messages, setMessages] = useState<Message[]>([]);

  /**
   * A box that survives re-renders without causing one.
   *
   * useRef hands back the SAME { current } object every render, so a value put in it
   * persists — a plain `const` in the component body is a fresh variable every call.
   * Writing .current does not re-render, which is the point: nothing on screen depends
   * on the socket object, so a render would be wasted. useState for what the screen
   * reads, useRef for what the code holds onto.
   *
   * Null until the effect below runs — on the first render no socket exists yet.
   */
  const wsRef = useRef<WebSocket | null>(null);

  /**
   * One socket per LOGIN, not per chat — which is why the deps are [token] alone.
   *
   * The cost of that: `selectedChatId` inside onmessage is frozen at the value it had
   * when this ran, so App cannot filter by chat here. It stores every arriving message
   * and MessageList filters at render time, where props are current.
   *
   * The guard is inside because hooks run in call order and cannot be skipped
   * conditionally. Returning undefined instead of a cleanup is allowed.
   */
  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(`${WS}/?token=${encodeURIComponent(token)}`);
    // The assignment is the whole point: it makes the socket reachable from outside this
    // effect, which is what lets the compose form send. Nulled in cleanup so a dead
    // socket is never handed to send().
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const m: Message = JSON.parse(e.data);
      setMessages((prev) => [...prev, m]);
    };

    return (() => {
      ws.close();
      wsRef.current = null;
    });
  }, [token]);

  // History for the selected chat. Boilerplate — this is the effect you already wrote,
  // moved up and with setMessages now pointing at App's state.
  //
  // It REPLACES rather than appends. Mongo is the source of truth, so a refetch already
  // contains anything that arrived live for this chat; replacing cannot lose a message
  // and cannot duplicate one. Known narrow race left in place: a live message arriving
  // while this fetch is in flight can appear twice.
  useEffect(() => {
    if (!token || !selectedChatId) return;

    async function load() {
      const res = await fetch(`${API}/chats/${selectedChatId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setMessages(data.messages);
    }

    load();
  }, [token, selectedChatId]);

  return (
    <div>
      <h1>Chatrooms</h1>
      <p className="muted">slice 11g — useRef and the socket in App</p>
      {!token && <LoginForm onLogin={setToken} />}
      {token && (
        <>
          <ChatList token={token} onSelect={setSelectedChatId} />
          {selectedChatId && (
            <MessageList messages={messages} chatId={selectedChatId} />
          )}
        </>
      )}
    </div>
  );
}
