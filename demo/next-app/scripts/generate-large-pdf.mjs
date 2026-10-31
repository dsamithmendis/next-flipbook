// Generates public/large-100.pdf, large-500.pdf and large-1000.pdf for the /large-pdf demo:
//   node scripts/generate-large-pdf.mjs [pages ...]
// The generator is shared with the benchmarks, so what you see here is what they measure.
import { mkdirSync, writeFileSync } from "node:fs";
import { makeBigPdf } from "../../../benchmarks/lib/big-pdf.mjs";

const sizes = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const target = new URL("../public/", import.meta.url);
mkdirSync(target, { recursive: true });

for (const pages of sizes.length > 0 ? sizes : [100, 500, 1000]) {
  const bytes = makeBigPdf({ pages, outline: true });
  writeFileSync(new URL(`large-${pages}.pdf`, target), bytes);
  console.log(`Wrote public/large-${pages}.pdf (${pages} pages, ${(bytes.length / 1024).toFixed(0)} KB)`);
}
