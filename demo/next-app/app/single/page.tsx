import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";
import { imagePages } from "../data";

export default function SingleDemo() {
  return (
    <main>
      <h1>Single page</h1>
      <p className="lede">One page at a time, with a darker theme and stronger shadows.</p>
      <Nav />
      <FlipBook
        pages={imagePages}
        mode="single"
        theme="dark"
        shadowIntensity={0.8}
        height="72vh"
      />
    </main>
  );
}
