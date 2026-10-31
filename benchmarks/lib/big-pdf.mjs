// Builds a valid, text-heavy PDF of any length with no dependencies, so benchmarks and the
// large-PDF demo need no binary fixtures. Each page has a coloured header band, about 40 lines
// of searchable text, a few vector shapes and a page number. Content streams are deflated and
// the page tree is two levels deep, like documents produced by real tools.
import { deflateSync } from "node:zlib";

const WORDS = (
  "slow train market night coast ticket window harbour river map station village bread cheese " +
  "lantern valley bridge morning evening journey platform ferry lighthouse orchard meadow " +
  "kettle blanket compass postcard timetable carriage tunnel summit shoreline courtyard " +
  "festival lantern garden staircase corridor library chapter paper window kitchen season"
).split(" ");

/** A small, repeatable pseudo random generator so the same page count gives the same file. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const escapeText = (value) => value.replace(/[\\()]/g, "\\$&");

function pageContent(index, total, next) {
  const hue = (index * 47) % 360;
  const channel = (offset) => (0.35 + 0.3 * Math.sin(((hue + offset) * Math.PI) / 180)).toFixed(3);
  let out = "";
  out += `${channel(0)} ${channel(120)} ${channel(240)} rg 0 740 612 52 re f\n`;
  out += `BT /F2 20 Tf 1 1 1 rg 54 758 Td (Chapter ${Math.floor(index / 10) + 1}  -  Page ${index + 1}) Tj ET\n`;
  // A few shapes so rendering is not only text.
  for (let i = 0; i < 4; i += 1) {
    const x = 380 + Math.round(next() * 150);
    const y = 560 + Math.round(next() * 150);
    out += `${(0.6 + next() * 0.35).toFixed(2)} ${(0.6 + next() * 0.35).toFixed(2)} ${(0.6 + next() * 0.35).toFixed(2)} rg ${x} ${y} ${30 + Math.round(next() * 60)} ${20 + Math.round(next() * 40)} re f\n`;
  }
  out += "0.12 0.12 0.14 rg\n";
  let y = 705;
  for (let line = 0; line < 40; line += 1) {
    let text = "";
    while (text.length < 74) text += `${WORDS[Math.floor(next() * WORDS.length)]} `;
    out += `BT /F1 10.5 Tf 54 ${y} Td (${escapeText(text.trim())}) Tj ET\n`;
    y -= 14.5;
  }
  out += `BT /F1 9 Tf 0.4 0.4 0.4 rg 296 28 Td (${index + 1} / ${total}) Tj ET\n`;
  return out;
}

/**
 * @param {{ pages: number, seed?: number, outline?: boolean }} options
 * @returns {Uint8Array}
 */
export function makeBigPdf({ pages, seed = 1, outline = false }) {
  const total = Math.max(1, Math.floor(pages));
  const next = random(seed);

  const GROUP = 32;
  const groups = Math.ceil(total / GROUP);
  // 1 catalog, 2 root of the page tree, 3 and 4 fonts, then the groups, pages and streams.
  const groupId = (g) => 5 + g;
  const pageId = (i) => 5 + groups + i * 2;
  const streamId = (i) => pageId(i) + 1;
  let nextId = 5 + groups + total * 2;
  const chapterCount = outline ? Math.ceil(total / 10) : 0;
  const outlineRoot = outline ? nextId++ : 0;
  const firstChapter = nextId;
  const chapterId = (c) => firstChapter + c;
  if (outline) nextId += chapterCount;

  const chunks = [];
  const offsets = new Map();
  let length = 0;
  const push = (data) => {
    const buffer = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    chunks.push(buffer);
    length += buffer.length;
  };
  const object = (id, body) => {
    offsets.set(id, length);
    push(`${id} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };

  push("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
  object(1, `<< /Type /Catalog /Pages 2 0 R${outline ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ""} >>`);
  object(
    2,
    `<< /Type /Pages /Count ${total} /Kids [${Array.from({ length: groups }, (_, g) => `${groupId(g)} 0 R`).join(" ")}] >>`,
  );
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  for (let g = 0; g < groups; g += 1) {
    const from = g * GROUP;
    const to = Math.min(total, from + GROUP);
    object(
      groupId(g),
      `<< /Type /Pages /Parent 2 0 R /Count ${to - from} /Kids [${Array.from({ length: to - from }, (_, k) => `${pageId(from + k)} 0 R`).join(" ")}] >>`,
    );
  }

  for (let i = 0; i < total; i += 1) {
    const group = Math.floor(i / GROUP);
    object(
      pageId(i),
      `<< /Type /Page /Parent ${groupId(group)} 0 R /MediaBox [0 0 612 792] /Contents ${streamId(i)} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
    );
    const body = deflateSync(Buffer.from(pageContent(i, total, next), "latin1"));
    offsets.set(streamId(i), length);
    push(`${streamId(i)} 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n`);
    push(body);
    push("\nendstream\nendobj\n");
  }

  if (outline) {
    object(
      outlineRoot,
      `<< /Type /Outlines /First ${chapterId(0)} 0 R /Last ${chapterId(chapterCount - 1)} 0 R /Count ${chapterCount} >>`,
    );
    for (let c = 0; c < chapterCount; c += 1) {
      const parts = [
        `/Title (Chapter ${c + 1})`,
        `/Parent ${outlineRoot} 0 R`,
        `/Dest [${pageId(c * 10)} 0 R /Fit]`,
      ];
      if (c > 0) parts.push(`/Prev ${chapterId(c - 1)} 0 R`);
      if (c < chapterCount - 1) parts.push(`/Next ${chapterId(c + 1)} 0 R`);
      object(chapterId(c), `<< ${parts.join(" ")} >>`);
    }
  }

  const xrefAt = length;
  const size = nextId;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    xref += `${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = Buffer.concat(chunks, length);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
