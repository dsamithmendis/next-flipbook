import type { FlipBookController } from "next-flipbook";

// What the demo's /large-pdf page puts on window for tests and benchmarks (see the page itself).
declare global {
  interface Window {
    __flipbookBench?: {
      controller: () => FlipBookController | null;
      firstPageAt: number | null;
      documentAt: number | null;
      pagesDrawn: number;
    };
  }
}
