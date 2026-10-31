import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";
import { imagePages } from "../data";

export default function ImagesDemo() {
  return (
    <main>
      <h1>Images with a cover</h1>
      <p className="lede">
        Page 1 is the front cover and page 10 the back cover. Drag a page to turn it, and let go
        early to watch it spring back. Shrink the window below 640px for a single page.
      </p>
      <Nav />
      <FlipBook pages={imagePages} cover height="72vh" initialPage={1} />
    </main>
  );
}
