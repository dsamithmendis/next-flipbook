"use client";

import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";

// The bundler copies the worker into your build and gives you its URL, so there
// is nothing to copy by hand. Works the same with Webpack 5, Turbopack and Vite.
const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export default function BundledWorkerDemo() {
  return (
    <main>
      <h1>PDF with a bundler-resolved worker</h1>
      <p className="lede">
        Same viewer, but the worker URL comes from <code>new URL(…, import.meta.url)</code> instead of
        a file in <code>public/</code>.
      </p>
      <Nav />
      <FlipBook source="/sample.pdf" pdf={{ workerSrc }} cover height="72vh" />
    </main>
  );
}
