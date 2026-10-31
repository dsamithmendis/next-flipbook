import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";

// A Server Component: `source` and `pdf` are plain, serializable data.
export default function PdfDemo() {
  return (
    <main>
      <h1>A PDF</h1>
      <p className="lede">
        Twelve pages rendered by PDF.js. Only the pages near the one you are reading are drawn, and
        pages you have moved away from are released.
      </p>
      <Nav />
      <FlipBook
        source="/sample.pdf"
        pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
        cover
        height="72vh"
      />
    </main>
  );
}
