import { sourceKey } from "../pdf/source.js";
import type { PdfOutlineItem, PdfSource } from "../pdf/types.js";
import type { FlipBookOutlineItem } from "../core/types.js";
import type { FlipBookPage } from "../types/index.js";

export type PositionIndex = ReadonlyMap<string, number>;

/** Where each PDF page sits in the book. The first position wins if a page is used twice. */
export function positionIndex(pages: readonly FlipBookPage[]): PositionIndex {
  const index = new Map<string, number>();
  pages.forEach((page, i) => {
    if (page.type !== "pdf") return;
    const key = `${sourceKey(page.source)}:${page.page}`;
    if (!index.has(key)) index.set(key, i + 1);
  });
  return index;
}

export function positionOf(index: PositionIndex, source: PdfSource, docPage: number): number | null {
  return index.get(`${sourceKey(source)}:${docPage}`) ?? null;
}

/** Converts a PDF's contents (pages of that PDF) into the book's page numbers. */
export function mapOutline(
  items: readonly PdfOutlineItem[],
  resolve: (docPage: number) => number | null,
): FlipBookOutlineItem[] {
  return items.map((item) => ({
    title: item.title,
    page: item.page === null ? null : resolve(item.page),
    url: item.url,
    bold: item.bold,
    italic: item.italic,
    items: mapOutline(item.items, resolve),
  }));
}
