// Generates public/guide.pdf: node scripts/generate-guide-pdf.mjs
// A 10-page PDF with searchable text, a nested table of contents (outline), internal links on
// the contents page and an external link on the back cover. No dependencies, ASCII only.
import { mkdirSync, writeFileSync } from "node:fs";

const W = 612;
const H = 792;
const MARGIN = 72;

const chapters = [
  {
    title: "Planning the journey",
    page: 3,
    sections: [{ title: "Packing light", page: 4 }],
    body: [
      "Every slow journey begins with a decision to leave something out. Fewer connections, fewer",
      "bookings and fewer bags make room for the things that happen between stations.",
      "",
      "Choose a start and an end, then let the middle stay loose. A good route has one fixed point",
      "a day and a long afternoon with nothing in it.",
    ],
    sectionBody: [
      "Carry what you can lift with one hand while you drink tea with the other. A change of",
      "clothes, a notebook, a paper map and a spare charger cover almost every journey.",
      "",
      "Pack the night before and leave a quarter of the bag empty for what you collect on the way.",
    ],
  },
  {
    title: "Getting around",
    page: 5,
    sections: [{ title: "Trains", page: 6 }],
    body: [
      "Trains are the heart of a slow journey. Windows that open, a dining car that serves tea,",
      "and a timetable that rewards patience.",
      "",
      "Buses fill the gaps between the lines, and ferries tie the coast together. Ask at each",
      "station which way the locals go; the answer is rarely the one the app gives.",
    ],
    sectionBody: [
      "Book the night train when the distance is long. You trade a hotel bill for a narrow bed",
      "and wake up somewhere new. Take a window seat, an early dinner and a book you will not finish.",
      "",
      "Day trains are for watching. Sit facing forward and let the landscape do the talking.",
    ],
  },
  {
    title: "Eating well",
    page: 7,
    sections: [{ title: "Markets", page: 8 }],
    body: [
      "Eat where the menu is short and the room is full. Order what the next table is having.",
      "",
      "Breakfast is the meal that tells you most about a place. Find the bakery with the queue",
      "and the cafe where nobody looks at a phone.",
    ],
    sectionBody: [
      "A market is the quickest way to learn a town. Walk a full lap before you buy anything,",
      "then go back for the stall that smelled best. Carry cash and small change.",
      "",
      "Buy bread, cheese and fruit for the next train. A picnic on a night train beats any menu.",
    ],
  },
  {
    title: "Coming home",
    page: 9,
    sections: [],
    body: [
      "The last day of a journey should be quiet. Walk the streets you walked on the first",
      "morning and notice what has changed, which is mostly you.",
      "",
      "Write down three things you want to keep. Then plan the next journey before the bags",
      "are unpacked.",
    ],
    sectionBody: [],
  },
];

const pageCount = 10;
const pageId = (page) => 6 + (page - 1) * 2; // 1-based page number to object number
const contentId = (page) => pageId(page) + 1;
let nextId = 6 + pageCount * 2;

const objects = new Map();
const esc = (text) => text.replace(/[\\()]/g, "\\$&");

/** Annotation objects by page, as { id, body }. */
const annots = new Map();
function addAnnot(page, body) {
  const id = nextId++;
  objects.set(id, body);
  annots.set(page, [...(annots.get(page) ?? []), id]);
}

const BLUE = "0.10 0.35 0.75";
const INK = "0.12 0.15 0.20";
const MUTED = "0.40 0.44 0.50";

const text = (font, size, x, y, value, color = INK) =>
  `${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET\n`;

function bodyLines(lines, startY, size = 13, lead = 19) {
  let ops = "";
  lines.forEach((line, i) => {
    if (line) ops += text("F1", size, MARGIN, startY - i * lead, line);
  });
  return ops;
}

const pages = new Map();

// 1: cover
pages.set(
  1,
  `0.12 0.20 0.30 rg 0 0 ${W} ${H} re f\n` +
    `0.95 0.62 0.25 rg 72 430 140 6 re f\n` +
    text("F2", 40, MARGIN, 360, "A Short Guide", "0.96 0.95 0.92") +
    text("F2", 40, MARGIN, 312, "to Slow Travel", "0.96 0.95 0.92") +
    text("F1", 14, MARGIN, 250, "Planning, trains, food and the way home", "0.80 0.84 0.88"),
);

// 2: contents, with a link on each line
let contents = text("F2", 28, MARGIN, 690, "Contents");
let y = 630;
for (const chapter of chapters) {
  contents += text("F1", 15, MARGIN, y, chapter.title, BLUE);
  contents += text("F1", 15, W - MARGIN - 20, y, String(chapter.page), MUTED);
  contents += `${BLUE} RG 0.6 w ${MARGIN} ${y - 3} m ${MARGIN + chapter.title.length * 7.4} ${y - 3} l S\n`;
  addAnnot(
    2,
    `<< /Type /Annot /Subtype /Link /Rect [${MARGIN} ${y - 6} ${W - MARGIN} ${y + 14}] /Border [0 0 0] /Dest [${pageId(chapter.page)} 0 R /Fit] >>`,
  );
  y -= 28;
  for (const section of chapter.sections) {
    contents += text("F1", 13, MARGIN + 22, y, section.title, MUTED);
    contents += text("F1", 13, W - MARGIN - 20, y, String(section.page), MUTED);
    addAnnot(
      2,
      `<< /Type /Annot /Subtype /Link /Rect [${MARGIN + 22} ${y - 6} ${W - MARGIN} ${y + 12}] /Border [0 0 0] /Dest [${pageId(section.page)} 0 R /Fit] >>`,
    );
    y -= 24;
  }
  y -= 10;
}
contents += text("F1", 11, MARGIN, 60, "Tap a line to go to that page.", MUTED);
pages.set(2, contents);

// chapter and section pages
for (const chapter of chapters) {
  pages.set(
    chapter.page,
    text("F2", 28, MARGIN, 690, chapter.title) +
      `0.95 0.62 0.25 rg ${MARGIN} 672 60 3 re f\n` +
      bodyLines(chapter.body, 630) +
      text("F1", 11, W / 2 - 4, 44, String(chapter.page), MUTED),
  );
  chapter.sections.forEach((section, index) => {
    pages.set(
      section.page,
      text("F2", 22, MARGIN, 690, section.title) +
        `0.95 0.62 0.25 rg ${MARGIN} 674 40 3 re f\n` +
        bodyLines(chapter.sectionBody, 630) +
        text("F1", 11, W / 2 - 4, 44, String(section.page), MUTED),
    );
    void index;
  });
}

// 10: back cover with an external link
pages.set(
  10,
  `0.12 0.20 0.30 rg 0 0 ${W} ${H} re f\n` +
    text("F2", 26, MARGIN, 420, "Safe travels.", "0.96 0.95 0.92") +
    text("F1", 14, MARGIN, 380, "More notes on slow travel:", "0.80 0.84 0.88") +
    text("F1", 14, MARGIN, 356, "https://example.com/slow-travel", "0.60 0.80 1") +
    `0.60 0.80 1 RG 0.7 w ${MARGIN} 353 m ${MARGIN + 31 * 7.2} 353 l S\n`,
);
addAnnot(
  10,
  `<< /Type /Annot /Subtype /Link /Rect [${MARGIN} 350 ${MARGIN + 31 * 7.2} 372] /Border [0 0 0] /A << /S /URI /URI (https://example.com/slow-travel) >> >>`,
);

// ---- fixed objects ---------------------------------------------------------

objects.set(1, "<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R /PageMode /UseOutlines >>");
objects.set(
  2,
  `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${pageId(i + 1)} 0 R`).join(" ")}] /Count ${pageCount} >>`,
);
objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
objects.set(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

for (let page = 1; page <= pageCount; page += 1) {
  const ops = pages.get(page) ?? "";
  const list = annots.get(page);
  objects.set(
    pageId(page),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contentId(page)} 0 R ` +
      `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >>` +
      (list ? ` /Annots [${list.map((id) => `${id} 0 R`).join(" ")}]` : "") +
      " >>",
  );
  objects.set(contentId(page), `<< /Length ${ops.length} >>\nstream\n${ops}endstream`);
}

// ---- outline (the bookmarks panel of a PDF viewer) --------------------------

const root = { id: 3, children: [] };
for (const chapter of chapters) {
  const node = { id: nextId++, title: chapter.title, page: chapter.page, parent: root, children: [] };
  root.children.push(node);
  for (const section of chapter.sections) {
    node.children.push({ id: nextId++, title: section.title, page: section.page, parent: node, children: [] });
  }
}

function emit(node) {
  const kids = node.children;
  kids.forEach((child, i) => {
    const prev = kids[i - 1];
    const next = kids[i + 1];
    objects.set(
      child.id,
      `<< /Title (${esc(child.title)}) /Parent ${node.id} 0 R` +
        (prev ? ` /Prev ${prev.id} 0 R` : "") +
        (next ? ` /Next ${next.id} 0 R` : "") +
        (child.children.length
          ? ` /First ${child.children[0].id} 0 R /Last ${child.children[child.children.length - 1].id} 0 R /Count ${child.children.length}`
          : "") +
        ` /Dest [${pageId(child.page)} 0 R /Fit] >>`,
    );
    emit(child);
  });
}
emit(root);
const total = (node) => node.children.reduce((sum, child) => sum + 1 + total(child), 0);
objects.set(
  3,
  `<< /Type /Outlines /First ${root.children[0].id} 0 R /Last ${root.children[root.children.length - 1].id} 0 R /Count ${total(root)} >>`,
);

// ---- write -------------------------------------------------------------------

const lastId = Math.max(...objects.keys());
let out = "%PDF-1.4\n";
const offsets = new Map();
for (let id = 1; id <= lastId; id += 1) {
  const body = objects.get(id);
  if (body === undefined) throw new Error(`Object ${id} was never defined`);
  offsets.set(id, out.length);
  out += `${id} 0 obj\n${body}\nendobj\n`;
}
const xref = out.length;
out += `xref\n0 ${lastId + 1}\n0000000000 65535 f \n`;
for (let id = 1; id <= lastId; id += 1) out += `${String(offsets.get(id)).padStart(10, "0")} 00000 n \n`;
out += `trailer\n<< /Size ${lastId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/guide.pdf", import.meta.url), out, "latin1");
console.log(`Wrote public/guide.pdf (${pageCount} pages, ${out.length} bytes)`);
