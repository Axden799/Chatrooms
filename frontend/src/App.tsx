import { useEffect, useState } from "react";

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

function MessageList({ token, chatId }: { token: string; chatId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    async function load() {
      const res = await fetch(`${API}/chats/${chatId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setMessages(data.messages);
    }

    load();
  }, [token, chatId]);

  // History above, live messages below: two jobs, two effects.
  //
  // The token rides in the query string because `new WebSocket(url)` takes only a URL —
  // the browser owns the handshake headers, so there is nowhere else to put it.
  useEffect(() => {
    const ws = new WebSocket(`${WS}/?token=${encodeURIComponent(token)}`);

    ws.onmessage = (e) => {
      const m: Message = JSON.parse(e.data);
      // One socket carries every chat this user belongs to — the server delivers to the
      // USER, not to a chat — so a list showing one chat has to drop the rest.
      if (m.chatId !== chatId) return;
      // Updater form, not [...messages, m]: this arrow was created during one run of the
      // effect and still reads that run's `messages`, which is []. React passes the
      // current value as `prev`, so nothing stale is read.
      setMessages((prev) => [...prev, m]);
    };

    // Returning a function is how an effect says "do this later." React calls it when the
    // deps change and on unmount. Without it, every chat switch leaks an open socket that
    // keeps firing setMessages. StrictMode's double-invoke makes that visible immediately.
    return () => ws.close();
    // Known cost of [chatId]: switching chats reconnects. The connection is really
    // per-user, so it belongs in App — a bigger refactor than this slice.
  }, [token, chatId]);

  const ordered = [...messages].reverse();

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

  return (
    <div>
      <h1>Chatrooms</h1>
      <p className="muted">slice 11e — props and lifted state</p>
        {!token && <LoginForm onLogin={setToken} />}
        {token && (
          <>
            <ChatList token={token} onSelect={setSelectedChatId} />
            {selectedChatId && (
              <MessageList token={token} chatId={selectedChatId} />
            )}
          </>
      )}
    </div>
  );
}
