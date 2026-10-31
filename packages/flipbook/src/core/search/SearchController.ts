import { compileQuery, findMatches, type PageText, type TextRect } from "./text.js";

export interface SearchResult {
  /** Position in the list of results. */
  index: number;
  /** Page number in the book (1-based). */
  position: number;
  before: string;
  match: string;
  after: string;
  rects: readonly TextRect[];
}

export type SearchStatus = "idle" | "searching" | "done";

export interface SearchSnapshot {
  readonly query: string;
  readonly status: SearchStatus;
  readonly results: readonly SearchResult[];
  /** Index of the selected result, or -1. */
  readonly current: number;
  /** Pages searched so far, out of `total`. */
  readonly scanned: number;
  readonly total: number;
  /** Stopped early because `maxResults` was reached. */
  readonly truncated: boolean;
}

export interface Highlight {
  rect: TextRect;
  /** Part of the selected result. */
  current: boolean;
}

/** Where the text comes from: the viewer maps book pages to PDF pages. */
export interface SearchSource {
  /** Pages in the book. */
  total: number;
  /** Text of page `position` (1-based), or null when it has none (an image, a React page). */
  getText(position: number, signal: AbortSignal): Promise<PageText | null>;
}

export interface SearchControllerOptions {
  /** Shortest query that searches. Default 2. */
  minLength?: number;
  /** Stop after this many results. Default 500. */
  maxResults?: number;
  /** Characters of context either side of a match. Default 40. */
  snippet?: number;
}

const EMPTY: SearchSnapshot = {
  query: "",
  status: "idle",
  results: [],
  current: -1,
  scanned: 0,
  total: 0,
  truncated: false,
};

/**
 * Searches the text of a book page by page and keeps the results, with no
 * DOM and no React.
 *
 * Results arrive as pages are read, so the first ones show up quickly even
 * in a long document, and a new query cancels the one before it. The result
 * to select first is the first at or after `startPosition` (the page being
 * read), wrapping to the first overall if there is none.
 */
export class SearchController {
  private readonly options: Required<SearchControllerOptions>;
  private source: SearchSource | null = null;
  private snapshot: SearchSnapshot = EMPTY;
  private abort: AbortController | null = null;
  private highlightsFor: SearchSnapshot | null = null;
  private highlights: ReadonlyMap<number, readonly Highlight[]> = new Map();
  private readonly listeners = new Set<() => void>();
  private readonly currentListeners = new Set<(result: SearchResult) => void>();

  constructor(options: SearchControllerOptions = {}) {
    this.options = {
      minLength: options.minLength ?? 2,
      maxResults: options.maxResults ?? 500,
      snippet: options.snippet ?? 40,
    };
  }

  readonly getSnapshot = (): SearchSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Fires whenever the selected result changes, so the viewer can go to its page. */
  readonly onCurrent = (listener: (result: SearchResult) => void): (() => void) => {
    this.currentListeners.add(listener);
    return () => {
      this.currentListeners.delete(listener);
    };
  };

  /** Changes the limits for the next search. */
  configure(options: SearchControllerOptions): void {
    if (options.minLength !== undefined) this.options.minLength = options.minLength;
    if (options.maxResults !== undefined) this.options.maxResults = options.maxResults;
    if (options.snippet !== undefined) this.options.snippet = options.snippet;
  }

  setSource(source: SearchSource | null): void {
    this.source = source;
  }

  /**
   * Highlight rectangles by page, for drawing over the pages. Computed once
   * per snapshot and shared, so calling it on every render is cheap.
   */
  getHighlights(): ReadonlyMap<number, readonly Highlight[]> {
    if (this.highlightsFor === this.snapshot) return this.highlights;
    const byPage = new Map<number, Highlight[]>();
    for (const result of this.snapshot.results) {
      const list = byPage.get(result.position) ?? [];
      for (const rect of result.rects) {
        list.push({ rect, current: result.index === this.snapshot.current });
      }
      byPage.set(result.position, list);
    }
    this.highlightsFor = this.snapshot;
    this.highlights = byPage;
    return byPage;
  }

  /** Runs a search. Resolves with the final snapshot, or the latest one if a newer search replaced this one. */
  async search(query: string, options: { startPosition?: number } = {}): Promise<SearchSnapshot> {
    this.cancel();
    const regex = compileQuery(query);
    const source = this.source;
    if (query.trim().length < this.options.minLength || !regex || !source) {
      this.set(query.trim() === "" ? EMPTY : { ...EMPTY, query });
      return this.snapshot;
    }

    const controller = new AbortController();
    this.abort = controller;
    const { signal } = controller;
    const total = source.total;
    const start = options.startPosition ?? 1;
    const results: SearchResult[] = [];
    let current = -1;
    let truncated = false;
    let lastShown = 0;

    this.set({ query, status: "searching", results: [], current: -1, scanned: 0, total, truncated: false });

    for (let position = 1; position <= total && !truncated; position += 1) {
      let text: PageText | null;
      try {
        text = await source.getText(position, signal);
      } catch {
        text = null; // an unreadable page is skipped, not fatal
      }
      if (signal.aborted) return this.snapshot;

      if (text) {
        for (const match of findMatches(text, regex, { snippet: this.options.snippet })) {
          if (results.length >= this.options.maxResults) {
            truncated = true;
            break;
          }
          results.push({
            index: results.length,
            position,
            before: match.before,
            match: match.match,
            after: match.after,
            rects: match.rects,
          });
        }
      }

      if (current < 0 && position >= start) {
        const first = results.find((result) => result.position >= start);
        if (first) current = first.index;
      }

      // Tell listeners when something new was found, and now and then while scanning.
      if (results.length !== lastShown || position % 8 === 0) {
        lastShown = results.length;
        this.publish({ query, status: "searching", results: [...results], current, scanned: position, total, truncated });
      }
    }

    if (current < 0 && results.length > 0) current = 0;
    this.abort = null;
    this.publish({ query, status: "done", results, current, scanned: total, total, truncated });
    return this.snapshot;
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  goTo(index: number): void {
    const { results } = this.snapshot;
    if (index < 0 || index >= results.length || index === this.snapshot.current) return;
    this.publish({ ...this.snapshot, current: index });
  }

  /** Cancels any search and forgets the results. */
  clear(): void {
    this.cancel();
    this.set(EMPTY);
  }

  // ---- internals -----------------------------------------------------------

  private step(direction: 1 | -1): void {
    const { results, current } = this.snapshot;
    if (results.length === 0) return;
    const next = (current + direction + results.length) % results.length;
    this.publish({ ...this.snapshot, current: next });
  }

  private cancel(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private set(snapshot: SearchSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }

  /** Updates the snapshot and announces a change of selected result. */
  private publish(next: SearchSnapshot): void {
    const previous = this.snapshot.current;
    this.set(next);
    if (next.current !== previous && next.current >= 0) {
      const result = next.results[next.current];
      if (result) for (const listener of [...this.currentListeners]) listener(result);
    }
  }
}
