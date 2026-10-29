import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

/**
 * The entry point. Three things happen here, once, when the page loads.
 *
 * 1. `document.getElementById("root")` finds the empty <div id="root"> in index.html.
 *    A plain DOM lookup, nothing React-specific.
 *
 * 2. `createRoot(...)` hands that div to React and says "you own this now".
 *
 * 3. `.render(<App />)` tells React what to put inside it.
 *
 * The `!` after getElementById is a TypeScript non-null assertion: getElementById
 * returns `HTMLElement | null` because the id might not exist, and `!` says "I know it
 * does". It is an assertion, not a check — the same category as `as`. It is tolerated
 * here only because index.html is three lines away and we can see the div.
 *
 * StrictMode is a development-only wrapper. It deliberately runs some of your code
 * TWICE to surface bugs — which will matter a great deal in slice 11f, where a
 * WebSocket opened without cleanup gets opened twice and you can see it happen.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
