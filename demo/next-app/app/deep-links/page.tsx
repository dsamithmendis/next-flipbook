import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";

// Plain anchors on purpose: a full page load shows the book opening at the page in the address.
// (next/link navigates without a reload; the book follows back and forward, not those.)
const stops = [1, 3, 5, 7, 9];

export default function DeepLinksDemo() {
  return (
    <main>
      <h1>Deep links and saved place</h1>
      <p className="lede">
        The address follows the page you are on, so any spread can be linked to or shared. If the
        address has no page, the book opens where you left off in this browser. Turn some pages,
        then reload, or follow one of these:
      </p>
      <Nav />
      <p style={{ font: "14px system-ui, sans-serif", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {stops.map((page) => (
          <a key={page} href={`/deep-links?page=${page}`}>
            Open at page {page}
          </a>
        ))}
        <a href="/deep-links">Open where I left off</a>
      </p>
      <FlipBook
        source="/guide.pdf"
        pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
        cover
        urlState
        persistState
        height="70vh"
      />
    </main>
  );
}
