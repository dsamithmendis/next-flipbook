import { FlipBook } from "next-flipbook";
import { Nav } from "./Nav";
import { imagePages } from "./data";

export default function Home() {
  return (
    <main>
      <h1>next-flipbook</h1>
      <p className="lede">
        This page is a Server Component that passes plain data to the client-side viewer. Drag or
        swipe a page to turn it, double-click or pinch to zoom, or use the buttons and arrow keys.
      </p>
      <Nav />
      <FlipBook pages={imagePages} cover height="72vh" />
    </main>
  );
}
