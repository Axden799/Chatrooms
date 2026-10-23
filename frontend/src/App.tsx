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
function Counter() {
  const [count, setCount] = useState(0);
  console.log("Counter() ran. count =", count);
  return (
    <div className="card">
      <p>
        count is <strong>{count}</strong>
      </p>
      <button onClick={() => setCount(count + 1)}>add one</button>
      <button onClick={() => setCount(0)}>reset</button>
    </div>
  );
}

/** What GET /chats returns for each chat. */
type Chat = {
  _id: string;
  participantIds: string[];
  createdAt: string;
};


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
function LoginForm() {

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      setToken(data.token);
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
        {token && <p className="muted">got a token, {token.length} chars</p>}
      </form>

      {chats.length > 0 && (
          <ul>
            {chats.map((c) => (
              <li key={c._id}>
                {c._id} - {c.participantIds.length} participants
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
export default function App() {
  return (
    <div>
      <h1>Chatrooms</h1>
      <p className="muted">slice 11b — useState</p>
      <Counter />
      <LoginForm />
    </div>
  );
}
