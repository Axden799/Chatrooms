/**
 * The root component. A component is a function that returns markup; React calls it
 * and puts the result inside <div id="root"> from index.html.
 *
 * JSX looks like HTML but is JavaScript, so `className` not `class`, attributes are
 * camelCase, every tag closes, and one top-level element is returned. `{ }` escapes
 * into JavaScript — anything inside is an expression.
 */
const projectName = "Chatrooms";
const slices = 11;
export default function App() {
  return (
    <div>
      <h1>React is Awesome</h1>
      <p>This is my first foray into React frontend! projectName</p>
      <p>What does this do? { 2 * 8 }</p>
      <p>How about this? { 0 && Boolean }</p>
      <p>{ projectName.toUpperCase() } and slices {slices + 5 }</p>
    </div>
  );
}
