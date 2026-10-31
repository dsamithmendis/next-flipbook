// Copies the PDF.js workers (modern and legacy) next to the app so they are served from your own origin.
// This is the bundler-independent way to host it: node scripts/copy-pdf-worker.mjs
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const target = new URL("../public/", import.meta.url);

mkdirSync(target, { recursive: true });
copyFileSync(join(pdfjsRoot, "build", "pdf.worker.min.mjs"), new URL("pdf.worker.min.mjs", target));
copyFileSync(
  join(pdfjsRoot, "legacy", "build", "pdf.worker.min.mjs"),
  new URL("pdf.worker.legacy.min.mjs", target),
);
console.log("Copied pdf.worker.min.mjs and pdf.worker.legacy.min.mjs to public/");
