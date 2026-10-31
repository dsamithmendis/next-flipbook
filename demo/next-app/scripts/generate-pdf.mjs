// Generates public/sample.pdf (12 pages) with no dependencies: node scripts/generate-pdf.mjs
// Pages use vector shapes plus Helvetica text, so the demo needs no binary assets.
import { mkdirSync, writeFileSync } from "node:fs";

const W = 612;
const H = 792;
const titles = [
  "Field Notes", "The Long Way Round", "Morning Light", "Harbour Towns", "Slow Trains", "Markets and Spice",
  "Night Ferries", "Hill Country", "Small Rooms", "Salt and Wind", "Last Light", "The End of the Line",
];
const hues = [212, 24, 168, 340, 48, 280, 196, 96, 8, 232, 150, 330];

function hsl(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => v.toFixed(3)).join(" ");
}

const esc = (text) => text.replace(/[\\()]/g, "\\$&");

function circle(cx, cy, r) {
  const k = 0.5523 * r;
  return `${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ` +
    `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ` +
    `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ` +
    `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c f`;
}

const contents = titles.map((title, index) => {
  const n = index + 1;
  const hue = hues[index];
  const cover = n === 1 || n === titles.length;
  const bg = cover ? hsl(hue, 42, 22) : hsl(hue, 30, 96);
  const ink = cover ? hsl(hue, 60, 92) : hsl(hue, 40, 18);
  const accent = hsl(hue, 65, cover ? 62 : 48);

  let ops = `${bg} rg 0 0 ${W} ${H} re f\n`;
  ops += `${accent} rg ${circle(n % 2 ? 440 : 170, 560, 150)}\n`;
  ops += `${accent} rg ${circle(n % 2 ? 360 : 250, 480, 80)}\n`;
  if (!cover) {
    ops += `${ink} rg\n`;
    for (let i = 0; i < 9; i += 1) {
      const w = 380 - ((i * 53 + n * 29) % 130);
      ops += `110 ${330 - i * 26} ${w} 7 re f\n`;
    }
  }
  ops += `${ink} rg BT /F1 ${cover ? 40 : 30} Tf 100 ${cover ? 260 : 380} Td (${esc(title)}) Tj ET\n`;
  if (!cover) ops += `${ink} rg BT /F1 14 Tf ${W / 2 - 4} 44 Td (${n}) Tj ET\n`;
  return ops;
});

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  `<< /Type /Pages /Kids [${contents.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${contents.length} >>`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
contents.forEach((ops, i) => {
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
  );
  objects.push(`<< /Length ${ops.length} >>\nstream\n${ops}endstream`);
});

let out = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(out.length);
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = out.length;
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/sample.pdf", import.meta.url), out, "latin1");
console.log(`Wrote public/sample.pdf (${contents.length} pages, ${out.length} bytes)`);
