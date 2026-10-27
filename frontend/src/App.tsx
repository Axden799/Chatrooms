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

/** Public by design — these accounts exist so anyone can see the project work. */
const DEMO_PASSWORD = "hunter2pw";

function LoginForm({ onLogin }: { onLogin: (t: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");


  /**
   * Takes the two values as arguments rather than reading them out of state, so the
   * demo buttons can call it with different ones. The request no longer touches state
   * at all.
   */
  async function login(u: string, p: string) {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      const data = await res.json();
      if (!res.ok) {
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

  // Only the two things specific to a form submit: stop the page navigation, and pick
  // which values to send.
  async function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    await login(username, password);
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
        <p className="muted">or try the demo — open two tabs, one as each:</p>
        <button type="button" disabled={loading} onClick={() => login("alice", DEMO_PASSWORD)}>
          log in as alice
        </button>
        <button type="button" disabled={loading} onClick={() => login("bob", DEMO_PASSWORD)}>
          log in as bob
        </button>
        {error && <p style={{color: "#c00"}}>{error}</p>}
      </form>
    </>
  );
}

/**
 * The compose box. Knows nothing about sockets, chats, or where the text goes.
 *
 * `draft` lives here rather than in App because a state change re-runs the component
 * that owns it: keeping it local means a keystroke re-renders this form alone, not the
 * message list. Push state as far down as it goes.
 *
 * preventDefault stops the browser's default form behaviour, which is a full page
 * NAVIGATION — a fresh document, all JavaScript discarded. That would destroy the token,
 * which lives only in App's state, and log the user out.
 *
 * It deliberately does not append to the list. The sent message comes back over the
 * socket like any other, because the server delivers to every participant including the
 * sender — so there is one writer to `messages` and one path for every message. The cost
 * is a round trip before you see your own text; optimistic UI (show it immediately,
 * reconcile on confirmation) is the alternative and needs temporary ids, a pending
 * state, and a rollback path.
 */
function Composer({ onSend }: { onSend: (body: string) => void }) {
  const [draft, setDraft] = useState("");

  function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="type a message" />
      <button type="submit">send</button>
    </form>
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

/** The localStorage key the token is kept under. */
const TOKEN_KEY = "chatrooms.token";

export default function App() {
  /**
   * Read the stored token on startup, so a refresh does not log the user out.
   *
   * The initial value is passed as a FUNCTION. useState only uses its argument on the
   * first render, but a plain expression is still evaluated on every one — the function
   * form means localStorage is read once. (React calls this a lazy initializer.)
   *
   * Storage is per origin and survives reloads, tab closes and browser restarts. It is
   * also readable by any JavaScript on the page, which is the trade-off against an
   * HttpOnly cookie: simpler, but a script-injection bug could exfiltrate the token.
   * Acceptable here because React escapes rendered text, so there is no injection path
   * short of dangerouslySetInnerHTML, and because the demo accounts are public.
   */
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
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

  /** Store the token alongside the state, so the two never disagree. */
  function handleLogin(t: string) {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }

  /**
   * Clear everything derived from the identity, storage included.
   *
   * Needed because storing the token introduces a state that did not exist before: a
   * STALE one. The token is signed with a 7-day expiry, but storage has no expiry, so
   * after a week the app starts up holding a token the server will refuse. Without this
   * the user would land on a blank page with no way back to the login form.
   */
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setSelectedChatId(null);
    setMessages([]);
  }

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

    // 1008 is the code src/index.ts closes with when the token does not verify, so it is
    // the one unambiguous "this token is no longer good" signal. Any other close code
    // (a dropped network, a server restart) is left alone — the token is still valid and
    // throwing the user out would be wrong.
    ws.onclose = (e) => {
      if (e.code === 1008) logout();
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

  /**
   * Why the ref exists: `ws` is a const inside the effect above and unreachable here.
   *
   * Two ways it can be unusable, hence two checks. Null means no socket yet (before
   * login) or the cleanup nulled it. Not OPEN means the socket is CONNECTING (0),
   * CLOSING (2) or CLOSED (3) — .send() throws on anything but OPEN (1), and submitting
   * during the handshake is genuinely reachable.
   *
   * senderId is deliberately absent from the payload. The server takes it from the
   * verified token on the connection, so a client cannot claim to be someone else.
   */
  function send(body: string) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ chatId: selectedChatId, body }));
  }

  return (
    <div>
      <h1>Chatrooms</h1>
      {!token && <LoginForm onLogin={handleLogin} />}
      {token && (
        <>
          <button type="button" onClick={logout}>log out</button>
          <ChatList token={token} onSelect={setSelectedChatId} />
          {selectedChatId && (
            <>
              <MessageList messages={messages} chatId={selectedChatId} />
              <Composer onSend={send} />
            </>
          )}
        </>
      )}
    </div>
  );
}
