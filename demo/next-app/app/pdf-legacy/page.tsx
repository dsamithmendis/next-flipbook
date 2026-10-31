"use client";

import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";

// pdfjs-dist's default build needs a browser released since about February 2026
// (Map.prototype.getOrInsertComputed). Its `legacy` build works on older ones.
// Both the library and the worker must be the legacy ones, and `loadPdfjs` is a
// function, so this page is a Client Component.
export default function PdfLegacyDemo() {
  return (
    <main>
      <h1>PDF for older browsers</h1>
      <p className="lede">
        The same guide, rendered by the <code>legacy</code> build of PDF.js. Use it when you need to
        support browsers that are more than a few months old.
      </p>
      <Nav />
      <FlipBook
        source="/guide.pdf"
        pdf={{
          loadPdfjs: () => import("pdfjs-dist/legacy/build/pdf.mjs"),
          workerSrc: "/pdf.worker.legacy.min.mjs",
        }}
        cover
        search
        outline
        thumbnails
        height="74vh"
      />
    </main>
  );
}
