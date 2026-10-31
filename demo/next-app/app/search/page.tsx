import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";

// A Server Component: `search` and `outline` are plain booleans.
export default function SearchDemo() {
  return (
    <main>
      <h1>Search, contents and links</h1>
      <p className="lede">
        A ten-page PDF with real text, its own table of contents and links. Press <code>/</code> to
        search (try &ldquo;train&rdquo; or &ldquo;market&rdquo;), open the contents from the toolbar,
        or click a line on the Contents page, which is a link inside the PDF. The link on the back
        cover opens in a new tab.
      </p>
      <Nav />
      <FlipBook
        source="/guide.pdf"
        pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
        cover
        search
        outline
        thumbnails
        height="74vh"
      />
    </main>
  );
}
