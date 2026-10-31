import type { FlipBookView } from "../types.js";

/**
 * What is visible at one reading position. Page numbers are 1-based and `null`
 * means that side is empty.
 *
 * `verso` and `recto` are direction-neutral: in left-to-right books the verso
 * is the left page and the recto the right page; in right-to-left books they
 * swap sides.
 */
export interface Spread {
  /** Side the reader has already turned past. */
  readonly verso: number | null;
  /** Side the reader is turning towards. */
  readonly recto: number | null;
}

export interface LayoutOptions {
  readonly pageCount: number;
  readonly view: FlipBookView;
  readonly cover: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Number of reading positions in the book. */
export function spreadCount({ pageCount, view, cover }: LayoutOptions): number {
  if (pageCount <= 0) return 0;
  if (view === "single") return pageCount;
  if (cover) return 1 + Math.ceil((pageCount - 1) / 2);
  return Math.ceil(pageCount / 2);
}

/**
 * The spread at `index` (clamped). Computed arithmetically, so a
 * 5,000-page book costs no more than a 5-page one.
 *
 * With `cover`, page 1 sits alone as the front cover. When the page count is
 * even, the last page is the back cover and sits alone.
 */
export function getSpread(index: number, options: LayoutOptions): Spread {
  const total = spreadCount(options);
  if (total === 0) return { verso: null, recto: null };

  const { pageCount, view, cover } = options;
  const i = clamp(Math.round(index), 0, total - 1);

  if (view === "single") return { verso: null, recto: i + 1 };

  if (cover && i === 0) return { verso: null, recto: 1 };

  const verso = cover ? 2 * i : 2 * i + 1;
  return { verso, recto: verso + 1 <= pageCount ? verso + 1 : null };
}

/** The spread that contains `page` (clamped to the valid range). */
export function pageToSpreadIndex(page: number, options: LayoutOptions): number {
  const p = clamp(Math.round(page), 1, Math.max(1, options.pageCount));
  if (options.view === "single") return p - 1;
  if (options.cover) return p === 1 ? 0 : Math.floor(p / 2);
  return Math.floor((p - 1) / 2);
}

/** Visible page numbers of a spread, verso first. */
export function spreadPages(spread: Spread): number[] {
  const pages: number[] = [];
  if (spread.verso !== null) pages.push(spread.verso);
  if (spread.recto !== null) pages.push(spread.recto);
  return pages;
}

/** The lowest-numbered visible page of a spread; 0 for an empty spread. */
export function spreadFirstPage(spread: Spread): number {
  return spread.verso ?? spread.recto ?? 0;
}
