/** The part of `Storage` that bookmarks need. `localStorage` and `sessionStorage` both fit. */
export interface BookmarkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type BookmarkChangeOrigin = "user" | "external";

export interface BookmarkStoreOptions {
  /** Pages in the book. 0 while it is still loading; bookmarks beyond a known count are dropped. */
  pageCount?: number;
  initial?: readonly number[];
}

const FORMAT_VERSION = 1;

const isPage = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

/**
 * The reader's bookmarked pages, with no DOM and no React.
 *
 * Pages are 1-based, unique and kept sorted. `toggle`, `add`, `remove` and
 * `clear` are user actions: they persist (when storage is configured) and
 * report to `onChange` with origin `"user"`. `replace` and `hydrate` bring
 * state in from outside, so they update subscribers but are reported as
 * `"external"`, which keeps a controlled `value` from echoing back.
 *
 * Storage is optional and every access is guarded: a full, blocked or
 * missing storage never throws.
 */
export class BookmarkStore {
  private pages: number[] = [];
  private pageCount: number;
  private snapshot: readonly number[] = [];
  private storage: BookmarkStorage | null = null;
  private storageKey: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<
    (pages: readonly number[], origin: BookmarkChangeOrigin) => void
  >();

  constructor(options: BookmarkStoreOptions = {}) {
    this.pageCount = Math.max(0, Math.floor(options.pageCount ?? 0));
    this.pages = this.normalise(options.initial ?? []);
    this.snapshot = Object.freeze([...this.pages]);
  }

  // ---- reading -------------------------------------------------------------

  /** Stable between changes. Pairs with `useSyncExternalStore`. */
  readonly getSnapshot = (): readonly number[] => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly onChange = (
    listener: (pages: readonly number[], origin: BookmarkChangeOrigin) => void,
  ): (() => void) => {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  };

  has(page: number): boolean {
    return this.pages.includes(page);
  }

  list(): number[] {
    return [...this.pages];
  }

  // ---- user actions --------------------------------------------------------

  /** Returns true if the page was added. False if it was already there or is out of range. */
  add(page: number): boolean {
    if (!this.valid(page) || this.has(page)) return false;
    this.pages = [...this.pages, page].sort((a, b) => a - b);
    this.commit("user");
    return true;
  }

  remove(page: number): boolean {
    if (!this.has(page)) return false;
    this.pages = this.pages.filter((p) => p !== page);
    this.commit("user");
    return true;
  }

  /** Returns whether the page is bookmarked afterwards. */
  toggle(page: number): boolean {
    if (this.has(page)) {
      this.remove(page);
      return false;
    }
    return this.add(page);
  }

  clear(): void {
    if (this.pages.length === 0) return;
    this.pages = [];
    this.commit("user");
  }

  // ---- state from outside --------------------------------------------------

  /** Replaces the whole list, for a controlled `value`. Not reported as a user change. */
  replace(pages: readonly number[]): void {
    const next = this.normalise(pages);
    if (sameList(next, this.pages)) return;
    this.pages = next;
    this.commit("external");
  }

  /**
   * Tells the store how many pages the book has. Bookmarks beyond the end
   * are dropped from view without touching what is saved, so a document that
   * is still loading never erases a reader's bookmarks.
   */
  setPageCount(count: number): void {
    const next = Math.max(0, Math.floor(count));
    if (next === this.pageCount) return;
    this.pageCount = next;
    const kept = this.normalise(this.pages);
    if (sameList(kept, this.pages)) return;
    this.pages = kept;
    this.refresh();
  }

  // ---- persistence -----------------------------------------------------------

  /** Points the store at a storage and key. Call `hydrate()` afterwards to load. */
  useStorage(storage: BookmarkStorage | null, key: string | null): void {
    this.storage = storage;
    this.storageKey = key;
  }

  /** Loads the saved list, replacing the current one. A no-op without storage or a saved value. */
  hydrate(): void {
    const saved = this.read();
    if (saved === null) return;
    this.replace(saved);
  }

  // ---- internals -----------------------------------------------------------

  private valid(page: number): boolean {
    return isPage(page) && (this.pageCount === 0 || page <= this.pageCount);
  }

  private normalise(pages: readonly number[]): number[] {
    const unique = new Set<number>();
    for (const page of pages) if (this.valid(page)) unique.add(page);
    return [...unique].sort((a, b) => a - b);
  }

  private refresh(): void {
    this.snapshot = Object.freeze([...this.pages]);
    for (const listener of [...this.listeners]) listener();
  }

  private commit(origin: BookmarkChangeOrigin): void {
    this.refresh();
    if (origin === "user") this.write();
    for (const listener of [...this.changeListeners]) listener(this.snapshot, origin);
  }

  private read(): number[] | null {
    if (!this.storage || !this.storageKey) return null;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      const list = (parsed as { pages?: unknown } | null)?.pages;
      if (!Array.isArray(list)) return null;
      return list.filter(isPage);
    } catch {
      return null;
    }
  }

  private write(): void {
    if (!this.storage || !this.storageKey) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify({ v: FORMAT_VERSION, pages: this.pages }));
    } catch {
      // Quota exceeded or storage blocked: bookmarks still work for this visit.
    }
  }
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
