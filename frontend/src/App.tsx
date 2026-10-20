import { useState } from "react";

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
function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className="card">
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password" />
      <p className="muted">
        Username is "{username}", password is {password.length} characters.
      </p>
    </div>
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
