/** A rectangle as fractions of the page (0..1), so it holds at any size or zoom. */
export interface TextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One run of text from the PDF, and where it sits on the page. */
export interface TextRun {
  /** Offsets into `PageText.text`. */
  start: number;
  end: number;
  rect: TextRect;
  /** False for rotated text, where a part of a run cannot be located by width alone. */
  horizontal: boolean;
}

export interface PageText {
  text: string;
  runs: readonly TextRun[];
}

/** The fields of a PDF.js text item that matter here. Marked-content entries have no `str`. */
export interface RawTextItem {
  str?: string;
  transform?: readonly number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export type RectMapper = (x: number, y: number, width: number, height: number) => TextRect;

/**
 * Joins a page's text items into one searchable string and remembers where
 * each run came from.
 *
 * PDF.js often splits a line into several items and leaves spaces implicit,
 * so a space is added where the next item starts clearly after the previous
 * one ends, or on a new line. Added spaces belong to no run.
 */
export function buildPageText(items: readonly RawTextItem[], toRect: RectMapper): PageText {
  let text = "";
  const runs: TextRun[] = [];
  let previous: { y: number; endX: number; height: number } | null = null;

  for (const item of items) {
    const str = item.str;
    const t = item.transform;
    if (typeof str !== "string" || !t || t.length < 6) continue;

    const x = t[4] as number;
    const y = t[5] as number;
    const width = item.width ?? 0;
    const height = item.height || Math.hypot(t[2] as number, t[3] as number) || 0;

    if (str.length > 0) {
      if (previous !== null && text.length > 0 && !/\s$/.test(text) && !/^\s/.test(str)) {
        const size = Math.max(previous.height, height);
        const sameLine = Math.abs(y - previous.y) < size * 0.5;
        if (!sameLine || x - previous.endX > size * 0.2) text += " ";
      }
      const start = text.length;
      text += str;
      runs.push({
        start,
        end: text.length,
        rect: toRect(x, y, width, height),
        horizontal: Math.abs(t[1] as number) < 1e-3 && Math.abs(t[2] as number) < 1e-3,
      });
      previous = { y, endX: x + width, height };
    }
    if (item.hasEOL && text.length > 0 && !/\s$/.test(text)) text += " ";
  }
  return { text, runs };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A case-insensitive pattern for a search string. Any run of whitespace in
 * the query matches any run of whitespace in the text, so a phrase still
 * matches across a line break. Returns null for an empty query.
 */
/** What one text run costs in memory: the run, its rectangle and their numbers. A measured estimate. */
const RUN_BYTES = 200;

/** Approximate memory held by a page's text, so a cache of pages can be given a byte budget. */
export function estimateTextBytes(page: PageText): number {
  return page.text.length * 2 + page.runs.length * RUN_BYTES;
}

export function compileQuery(query: string): RegExp | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return new RegExp(words.map(escapeRegExp).join("\\s+"), "giu");
}

export interface TextMatch {
  start: number;
  end: number;
  /** Where the match is on the page: one rectangle per run it touches. */
  rects: TextRect[];
  /** Text around the match, for a result list. Whitespace is collapsed. */
  before: string;
  match: string;
  after: string;
}

const collapse = (value: string): string => value.replace(/\s+/g, " ");

/** Every match of `regex` in a page. The regex must be global (`compileQuery` makes one). */
export function findMatches(
  page: PageText,
  regex: RegExp,
  options: { snippet?: number; limit?: number } = {},
): TextMatch[] {
  const { snippet = 40, limit = Infinity } = options;
  const matches: TextMatch[] = [];
  regex.lastIndex = 0;
  let found: RegExpExecArray | null;

  while ((found = regex.exec(page.text)) !== null && matches.length < limit) {
    const start = found.index;
    const end = start + found[0].length;
    if (end === start) {
      regex.lastIndex += 1;
      continue;
    }

    const rects: TextRect[] = [];
    for (const run of page.runs) {
      if (run.end <= start || run.start >= end) continue;
      if (!run.horizontal) {
        rects.push({ ...run.rect });
        continue;
      }
      const length = run.end - run.start;
      const from = (Math.max(start, run.start) - run.start) / length;
      const to = (Math.min(end, run.end) - run.start) / length;
      rects.push({
        x: run.rect.x + run.rect.width * from,
        y: run.rect.y,
        width: run.rect.width * (to - from),
        height: run.rect.height,
      });
    }

    const cutBefore = start - snippet > 0;
    const cutAfter = end + snippet < page.text.length;
    matches.push({
      start,
      end,
      rects,
      before: (cutBefore ? "…" : "") + collapse(page.text.slice(Math.max(0, start - snippet), start)).trimStart(),
      match: collapse(page.text.slice(start, end)),
      after: collapse(page.text.slice(end, end + snippet)).trimEnd() + (cutAfter ? "…" : ""),
    });
  }
  return matches;
}
