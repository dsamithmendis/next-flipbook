// Generates the demo page images: node scripts/generate-pages.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const out = new URL("../public/pages/", import.meta.url);
mkdirSync(out, { recursive: true });

const W = 600;
const H = 800;
const titles = [
  "Field Notes",
  "The Long Way Round",
  "Morning Light",
  "Harbour Towns",
  "Slow Trains",
  "Markets & Spice",
  "Night Ferries",
  "Hill Country",
  "Small Rooms",
  "The End of the Line",
];
const hues = [212, 24, 168, 340, 48, 280, 196, 96, 8, 232];

titles.forEach((title, index) => {
  const n = index + 1;
  const hue = hues[index];
  const isCover = n === 1 || n === titles.length;
  const bg = isCover ? `hsl(${hue} 42% 22%)` : `hsl(${hue} 30% 96%)`;
  const ink = isCover ? `hsl(${hue} 60% 92%)` : `hsl(${hue} 40% 18%)`;
  const accent = `hsl(${hue} 65% ${isCover ? 62 : 48}%)`;

  const lines = Array.from({ length: isCover ? 0 : 9 }, (_, i) => {
    const y = 470 + i * 26;
    const w = 380 - ((i * 53 + n * 29) % 130);
    return `<rect x="110" y="${y}" width="${w}" height="8" rx="4" fill="${ink}" opacity="0.16"/>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <circle cx="${n % 2 ? 470 : 130}" cy="220" r="150" fill="${accent}" opacity="${isCover ? 0.35 : 0.22}"/>
  <circle cx="${n % 2 ? 380 : 220}" cy="300" r="90" fill="${accent}" opacity="0.5"/>
  <text x="110" y="${isCover ? 560 : 400}" font-family="Georgia, 'Times New Roman', serif" font-size="${isCover ? 52 : 40}" fill="${ink}">${title}</text>
  ${lines}
  <text x="${W / 2}" y="${H - 44}" text-anchor="middle" font-family="Georgia, serif" font-size="18" fill="${ink}" opacity="0.6">${isCover ? "" : n}</text>
</svg>
`;
  writeFileSync(new URL(`page-${n}.svg`, out), svg);
});

console.log(`Wrote ${titles.length} pages to public/pages`);
