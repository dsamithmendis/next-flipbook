interface Entry<V> {
  value: V;
  /** Where the page sits in the book, used to rank how useful it still is. */
  position: number;
  bytes: number;
  /** Recency: higher means used more recently. */
  tick: number;
}

export interface PageCacheHooks<V> {
  /** Called once for every value that leaves the cache. Release its memory here. */
  onEvict?: (key: string, value: V) => void;
  /** Return false to keep an entry that is still on screen. */
  canEvict?: (key: string, value: V) => boolean;
}

export interface PageCacheLimits {
  maxEntries: number;
  /** Soft memory budget. Unbounded when omitted. */
  maxBytes?: number;
}

/** Counters for diagnosing and benchmarking a cache. Reads are cheap and never allocate per entry. */
export interface PageCacheStats {
  /** Entries held right now. */
  entries: number;
  /** Bytes held right now, as reported when each entry was stored. */
  bytes: number;
  /** `get()` calls that found an entry. `peek()` and `has()` are not counted. */
  hits: number;
  /** `get()` calls that found nothing. */
  misses: number;
  /** Entries removed to stay inside the limits. Explicit deletes and `clear()` are not counted. */
  evictions: number;
  /** The most entries and bytes held at any one time since the last reset. */
  peakEntries: number;
  peakBytes: number;
}

/**
 * Bounded cache for rendered pages.
 *
 * Eviction is LRU with a locality bias: when the cache is over budget, the
 * entry farthest from the reader's position goes first, and among equals the
 * least recently used. Protected keys (the pages on screen) are never evicted.
 */
export class PageCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly hooks: PageCacheHooks<V>;
  private limits: PageCacheLimits;
  private tick = 0;
  private totalBytes = 0;
  private focus = 0;
  private keep: ReadonlySet<string> = new Set();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private peakEntries = 0;
  private peakBytes = 0;

  constructor(limits: PageCacheLimits, hooks: PageCacheHooks<V> = {}) {
    this.limits = { ...limits };
    this.hooks = hooks;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  /** A snapshot of the counters. */
  stats(): PageCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.totalBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      peakEntries: this.peakEntries,
      peakBytes: this.peakBytes,
    };
  }

  /** Zeroes the counters. The peaks restart from what is held now. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.peakEntries = this.entries.size;
    this.peakBytes = this.totalBytes;
  }

  getFocus(): number {
    return this.focus;
  }

  /** The limits in force. */
  getLimits(): Readonly<PageCacheLimits> {
    return this.limits;
  }

  setLimits(limits: Partial<PageCacheLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.trim();
  }

  /** Marks the reader's current position. Nearby entries are kept longest. */
  setFocus(position: number): void {
    this.focus = position;
  }

  /** Entries that must survive trimming, typically the visible pages. */
  protect(keys: Iterable<string>): void {
    this.keep = new Set(keys);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Reads an entry and marks it as recently used. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    entry.tick = ++this.tick;
    return entry.value;
  }

  /** Reads an entry without affecting its recency. */
  peek(key: string): V | undefined {
    return this.entries.get(key)?.value;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  keysWithPrefix(prefix: string): string[] {
    return this.keys().filter((key) => key.startsWith(prefix));
  }

  set(key: string, value: V, info: { position: number; bytes?: number }): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      if (existing.value !== value) this.hooks.onEvict?.(key, existing.value);
    }
    const bytes = info.bytes ?? 0;
    this.entries.set(key, { value, position: info.position, bytes, tick: ++this.tick });
    this.totalBytes += bytes;
    // Peaks are taken before trimming: this is the most memory the cache asked for.
    if (this.entries.size > this.peakEntries) this.peakEntries = this.entries.size;
    if (this.totalBytes > this.peakBytes) this.peakBytes = this.totalBytes;
    this.trim();
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    this.hooks.onEvict?.(key, entry.value);
    return true;
  }

  deleteWithPrefix(prefix: string): void {
    for (const key of this.keysWithPrefix(prefix)) this.delete(key);
  }

  clear(): void {
    for (const key of this.keys()) this.delete(key);
    this.keep = new Set();
  }

  private overBudget(): boolean {
    if (this.entries.size > this.limits.maxEntries) return true;
    const { maxBytes } = this.limits;
    return maxBytes !== undefined && this.totalBytes > maxBytes;
  }

  private trim(): void {
    while (this.overBudget()) {
      let victim: string | null = null;
      let victimDistance = -1;
      let victimTick = Infinity;

      for (const [key, entry] of this.entries) {
        if (this.keep.has(key)) continue;
        if (this.hooks.canEvict && !this.hooks.canEvict(key, entry.value)) continue;
        const distance = Math.abs(entry.position - this.focus);
        if (
          distance > victimDistance ||
          (distance === victimDistance && entry.tick < victimTick)
        ) {
          victim = key;
          victimDistance = distance;
          victimTick = entry.tick;
        }
      }

      // Everything left is protected: stay over budget rather than blank a visible page.
      if (victim === null) return;
      this.evictions += 1;
      this.delete(victim);
    }
  }
}
