import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";
import { imagePages } from "../data";

export default function RtlDemo() {
  return (
    <main>
      <h1>Right to left</h1>
      <p className="lede">
        The spine and the turn direction are mirrored, and the arrow keys follow reading order:
        left arrow goes forward.
      </p>
      <Nav />
      <FlipBook pages={imagePages} direction="rtl" cover height="72vh" />
    </main>
  );
}
