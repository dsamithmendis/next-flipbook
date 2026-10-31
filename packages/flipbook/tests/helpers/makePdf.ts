export interface PdfLinkSpec {
  rect: [number, number, number, number];
  /** A web address. */
  url?: string;
  /** A page of this PDF (1-based). */
  page?: number;
  /** A named destination declared in `MakePdfOptions.destinations`. */
  dest?: string;
}

export interface PdfPageSpec {
  width?: number;
  height?: number;
  /** Raw PDF content stream operators. ASCII only. */
  content: string;
  links?: PdfLinkSpec[];
}

export interface PdfOutlineSpec {
  title: string;
  page: number;
  children?: PdfOutlineSpec[];
}

export interface MakePdfOptions {
  outline?: PdfOutlineSpec[];
  /** Named destinations: name to page (1-based). */
  destinations?: Record<string, number>;
}

const escapeText = (value: string): string => value.replace(/[\\()]/g, "\\$&");

/** A line of Helvetica text. Pair with `makePdf` pages that need searchable text. */
export const text = (value: string, x: number, y: number, size = 18): string =>
  `BT /F1 ${size} Tf ${x} ${y} Td (${escapeText(value)}) Tj ET\n`;

interface OutlineNode {
  spec: PdfOutlineSpec;
  id: number;
  parent: number;
  children: OutlineNode[];
}

/**
 * Builds a small, valid PDF so tests need no binary fixtures: pages with text
 * and vector shapes, link annotations, a nested outline and named destinations.
 */
export function makePdf(pages: PdfPageSpec[], options: MakePdfOptions = {}): Uint8Array {
  let next = 4; // 1 catalog, 2 page tree, 3 font
  const pageIds = pages.map(() => next++);
  const contentIds = pages.map(() => next++);
  const linkIds = pages.map((page) => (page.links ?? []).map(() => next++));

  const outlineRoot = options.outline?.length ? next++ : null;
  const buildNodes = (specs: PdfOutlineSpec[], parent: number): OutlineNode[] => {
    const nodes: OutlineNode[] = specs.map((spec) => ({ spec, id: next++, parent, children: [] }));
    for (const node of nodes) node.children = buildNodes(node.spec.children ?? [], node.id);
    return nodes;
  };
  const top = outlineRoot ? buildNodes(options.outline ?? [], outlineRoot) : [];

  const bodies = new Map<number, string>();
  const pageRef = (page: number): string => `${pageIds[page - 1]} 0 R`;

  const destinations = Object.entries(options.destinations ?? {})
    .map(([name, page]) => `/${name} [${pageRef(page)} /XYZ 0 792 0]`)
    .join(" ");
  bodies.set(
    1,
    `<< /Type /Catalog /Pages 2 0 R${outlineRoot ? ` /Outlines ${outlineRoot} 0 R` : ""}${
      destinations ? ` /Dests << ${destinations} >>` : ""
    } >>`,
  );
  bodies.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  bodies.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((page, index) => {
    const annots = linkIds[index] ?? [];
    bodies.set(
      pageIds[index] as number,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width ?? 612} ${page.height ?? 792}] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 3 0 R >> >>${
        annots.length ? ` /Annots [${annots.map((id) => `${id} 0 R`).join(" ")}]` : ""
      } >>`,
    );
    bodies.set(
      contentIds[index] as number,
      `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`,
    );
    (page.links ?? []).forEach((link, linkIndex) => {
      let action = "";
      if (link.url !== undefined) action = `/A << /S /URI /URI (${escapeText(link.url)}) >>`;
      else if (link.page !== undefined) action = `/Dest [${pageRef(link.page)} /Fit]`;
      else if (link.dest !== undefined) action = `/Dest /${link.dest}`;
      bodies.set(
        (linkIds[index] as number[])[linkIndex] as number,
        `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(" ")}] /Border [0 0 0] ${action} >>`,
      );
    });
  });

  if (outlineRoot) {
    let total = 0;
    const write = (nodes: OutlineNode[]): void => {
      nodes.forEach((node, i) => {
        total += 1;
        const prev = nodes[i - 1];
        const following = nodes[i + 1];
        const first = node.children[0];
        const last = node.children[node.children.length - 1];
        bodies.set(
          node.id,
          `<< /Title (${escapeText(node.spec.title)}) /Parent ${node.parent} 0 R${prev ? ` /Prev ${prev.id} 0 R` : ""}${
            following ? ` /Next ${following.id} 0 R` : ""
          }${first && last ? ` /First ${first.id} 0 R /Last ${last.id} 0 R /Count ${node.children.length}` : ""} /Dest [${pageRef(node.spec.page)} /Fit] >>`,
        );
        write(node.children);
      });
    };
    write(top);
    const first = top[0] as OutlineNode;
    const last = top[top.length - 1] as OutlineNode;
    bodies.set(outlineRoot, `<< /Type /Outlines /First ${first.id} 0 R /Last ${last.id} 0 R /Count ${total} >>`);
  }

  const count = next - 1;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id <= count; id += 1) {
    offsets.push(out.length);
    out += `${id} 0 obj\n${bodies.get(id) ?? "null"}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export const redPage: PdfPageSpec = { content: "1 0 0 rg 100 100 400 600 re f" };
export const bluePage: PdfPageSpec = { content: "0 0 1 rg 100 100 400 600 re f" };
