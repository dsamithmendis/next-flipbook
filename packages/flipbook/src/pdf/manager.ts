import { PageCache } from "../core/cache/PageCache.js";
import type { FlipBookError } from "../core/errors.js";
import type { FlipBookCacheStats } from "../core/types.js";
import type { CanvasFactory, RenderedPage } from "./renderer.js";
import { PdfSession, type PdfSessionEvents } from "./session.js";
import { sourceKey } from "./source.js";
import type { PasswordReason, PdfOptions, PdfSource } from "./types.js";

const DEFAULT_MAX_CACHE_BYTES = 192 * 1024 * 1024;
const THUMBNAIL_CACHE_ENTRIES = 160;
const THUMBNAIL_CACHE_BYTES = 40 * 1024 * 1024;

export interface PdfManagerConfig {
  options: () => PdfOptions;
  events: () => PdfSessionEvents;
  /** Maximum number of cached page renders. */
  cacheSize: () => number;
}

/** What the viewer is holding in memory, for diagnostics and tuning. */
export type PdfCacheStats = FlipBookCacheStats;

export interface PdfManagerInternals {
  createCanvas?: CanvasFactory;
  getDevicePixelRatio?: () => number;
}

export interface PasswordRequest {
  /** Changes for every new prompt, so a UI can tell a retry from a repeat. */
  id: string;
  session: PdfSession;
  reason: PasswordReason;
}

export interface FocusArgs {
  /** Page numbers on screen. */
  visible: readonly number[];
  /** Pages in the book. */
  total: number;
  /** How many pages either side of the visible ones to prepare. */
  radius: number;
  /** Maps a book page number to the PDF page that fills it, or null for non-PDF pages. */
  resolve: (position: number) => { source: PdfSource; page: number } | null;
}

/**
 * Owns every open PDF for one viewer, plus the shared page cache.
 *
 * Reusable after `dispose()`, which releases all documents, workers and
 * canvases. That keeps it safe under React Strict Mode's mount, unmount,
 * mount sequence.
 */
export class PdfManager {
  readonly cache: PageCache<RenderedPage>;
  /** Small renders for the thumbnail list, kept apart so they never push real pages out. */
  readonly thumbnailCache: PageCache<RenderedPage>;
  private readonly config: PdfManagerConfig;
  private readonly internals: PdfManagerInternals;
  private readonly sessions = new Map<string, PdfSession>();
  private readonly unsubscribe = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private nextId = 1;
  private viewportWidth = 0;
  private baseWidth = 0;

  constructor(config: PdfManagerConfig, internals: PdfManagerInternals = {}) {
    this.config = config;
    this.internals = internals;
    const hooks = {
      // Shrinking a canvas to nothing is what actually frees its pixels on Safari.
      onEvict: (_key: string, page: RenderedPage) => {
        page.canvas.width = 0;
        page.canvas.height = 0;
      },
      // A canvas that is in the document is on screen; never blank it.
      canEvict: (_key: string, page: RenderedPage) => !page.canvas.isConnected,
    };
    this.cache = new PageCache<RenderedPage>(
      {
        maxEntries: Math.max(1, config.cacheSize()),
        maxBytes: config.options().maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES,
      },
      hooks,
    );
    this.thumbnailCache = new PageCache<RenderedPage>(
      { maxEntries: THUMBNAIL_CACHE_ENTRIES, maxBytes: THUMBNAIL_CACHE_BYTES },
      hooks,
    );
  }

  // ---- change notification (useSyncExternalStore) --------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = (): number => this.version;

  private bump(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  // ---- sessions ------------------------------------------------------------

  /** Opens sources that are new and closes sources that are no longer used. */
  sync(sources: readonly PdfSource[]): void {
    const wanted = new Map<string, PdfSource>();
    for (const source of sources) wanted.set(sourceKey(source), source);

    let changed = false;
    for (const key of [...this.sessions.keys()]) {
      if (!wanted.has(key)) {
        this.close(key);
        changed = true;
      }
    }
    for (const [key, source] of wanted) {
      if (this.sessions.has(key)) continue;
      this.open(key, source);
      changed = true;
    }
    if (changed) this.bump();
  }

  getSession(source: PdfSource): PdfSession | undefined {
    return this.sessions.get(sourceKey(source));
  }

  private open(key: string, source: PdfSource): void {
    const session = new PdfSession({
      id: `s${this.nextId++}`,
      source,
      options: this.config.options(),
      cache: this.cache,
      thumbnailCache: this.thumbnailCache,
      events: this.config.events,
      ...(this.internals.createCanvas ? { createCanvas: this.internals.createCanvas } : {}),
      ...(this.internals.getDevicePixelRatio
        ? { getDevicePixelRatio: this.internals.getDevicePixelRatio }
        : {}),
    });
    this.sessions.set(key, session);
    this.unsubscribe.set(key, session.subscribe(() => this.bump()));
    session.open();
  }

  private close(key: string): void {
    this.unsubscribe.get(key)?.();
    this.unsubscribe.delete(key);
    this.sessions.get(key)?.destroy();
    this.sessions.delete(key);
  }

  /** The first document asking for a password, if any. */
  getPasswordRequest(): PasswordRequest | null {
    for (const session of this.sessions.values()) {
      const snapshot = session.getSnapshot();
      if (snapshot.status === "password" && snapshot.passwordReason) {
        return {
          id: `${session.id}:${snapshot.passwordRequest}`,
          session,
          reason: snapshot.passwordReason,
        };
      }
    }
    return null;
  }

  /** Documents that failed to load, each with a stable id for de-duplication. */
  getSessionErrors(): Array<{ id: string; error: FlipBookError }> {
    const errors: Array<{ id: string; error: FlipBookError }> = [];
    for (const session of this.sessions.values()) {
      const { error } = session.getSnapshot();
      if (error) errors.push({ id: session.id, error });
    }
    return errors;
  }

  // ---- viewport & prefetch -------------------------------------------------

  /**
   * Width, in CSS pixels, that visible pages are rendered for. When the book
   * is zoomed in this is larger than the page's layout width (`baseWidth`),
   * so the pages on screen are sharp while pages being prepared in advance
   * are drawn at the cheaper fitted size.
   */
  setViewportWidth(width: number, baseWidth: number = width): void {
    if (width === this.viewportWidth && baseWidth === this.baseWidth) return;
    this.viewportWidth = width;
    this.baseWidth = baseWidth;
    this.bump();
  }

  getViewportWidth(): number {
    return this.viewportWidth;
  }

  updateLimits(): void {
    this.cache.setLimits({
      maxEntries: Math.max(1, this.config.cacheSize()),
      maxBytes: this.config.options().maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES,
    });
  }

  /**
   * Prepares the pages around the reader: visible pages first, then the next
   * page, the previous page, and outward. The window is cut short where the
   * cache could not hold it, because pages prepared beyond that would only be
   * evicted and drawn again. Work that has fallen out of range is dropped, and
   * pages on screen are pinned in the cache.
   */
  focus({ visible, total, radius, resolve }: FocusArgs): void {
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (first === undefined || last === undefined) return;

    this.cache.setFocus(first);
    this.thumbnailCache.setFocus(first);

    const width = this.viewportWidth;
    const prefetchWidth = this.baseWidth > 0 ? Math.min(this.baseWidth, width) : width;
    const limits = this.cache.getLimits();

    const from = Math.max(1, first - radius);
    const to = Math.min(total, last + radius);
    const order = [...visible];
    for (let step = 1; step <= radius; step += 1) {
      if (last + step <= to) order.push(last + step);
      if (first - step >= from) order.push(first - step);
    }

    // The pages on screen always make the plan. Then, nearest first, pages are added
    // for as long as the cache has room for them in entries and in bytes.
    const plan: Array<{ position: number; session: PdfSession; page: number; cssWidth: number; isVisible: boolean }> = [];
    let entries = 0;
    let bytes = 0;
    for (const position of order) {
      const ref = resolve(position);
      if (!ref || width <= 0) continue;
      const session = this.getSession(ref.source);
      if (!session || session.getSnapshot().status !== "ready") continue;

      const isVisible = visible.includes(position);
      const cssWidth = isVisible ? width : prefetchWidth;
      const cost = session.estimateBytes(cssWidth);
      if (!isVisible) {
        if (entries + 1 > limits.maxEntries) break;
        if (limits.maxBytes !== undefined && bytes + cost > limits.maxBytes) break;
      }
      entries += 1;
      bytes += cost;
      plan.push({ position, session, page: ref.page, cssWidth, isVisible });
    }

    const pinned: string[] = [];
    let low = first;
    let high = last;
    for (const item of plan) {
      low = Math.min(low, item.position);
      high = Math.max(high, item.position);
      if (item.isVisible) {
        const key = item.session.keyFor(item.page, width);
        if (key) pinned.push(key);
      }
    }

    this.cache.protect(pinned);
    for (const session of this.sessions.values()) session.cancelOutside(low, high);
    for (const item of plan) {
      item.session
        .request(item.page, { position: item.position, cssWidth: item.cssWidth, prefetch: !item.isVisible })
        .catch(() => undefined);
    }
  }

  /** Memory held by page renders, thumbnails and the search index. */
  getCacheStats(): PdfCacheStats {
    let pages = 0;
    let bytes = 0;
    for (const session of this.sessions.values()) {
      const memory = session.getMemoryStats();
      pages += memory.textPages;
      bytes += memory.textBytes;
    }
    return {
      pages: this.cache.stats(),
      thumbnails: this.thumbnailCache.stats(),
      text: { pages, bytes },
    };
  }

  // ---- teardown ------------------------------------------------------------

  /** Closes every document and empties the cache. The manager can be used again afterwards. */
  dispose(): void {
    for (const key of [...this.sessions.keys()]) this.close(key);
    this.cache.clear();
    this.thumbnailCache.clear();
    this.viewportWidth = 0;
    this.baseWidth = 0;
    this.bump();
  }
}
