import type { PageCache } from "../core/cache/PageCache.js";
import { FlipBookRuntimeError, type FlipBookError } from "../core/errors.js";
import { buildPageText, estimateTextBytes, type PageText, type TextRect } from "../core/search/text.js";
import { CancelledError, isCancellation, mapPdfError } from "./errors.js";
import { safeUrl } from "./links.js";
import {
  chooseRenderScale,
  defaultCanvasFactory,
  renderPdfPage,
  type CanvasFactory,
  type RenderedPage,
} from "./renderer.js";
import { resolveDocumentInit } from "./source.js";
import type {
  PasswordReason,
  PdfDocumentProxy,
  PdfLoadingTask,
  PdfOptions,
  PdfOutlineItem,
  PdfPageLink,
  PdfPageProxy,
  PdfRawOutlineItem,
  PdfSource,
  PdfViewport,
} from "./types.js";
import { loadPdfjs } from "./worker.js";

const NEED_PASSWORD = 1;
const DEFAULT_MAX_PIXELS = 12_000_000;
/** Thumbnails never need more than this many pixels. */
const THUMBNAIL_MAX_PIXELS = 400_000;
const DEFAULT_CONCURRENCY = 2;
const MAX_DEVICE_PIXEL_RATIO = 3;
/** Extracted text is kept up to this many bytes, least recently used first out. */
const DEFAULT_TEXT_CACHE_BYTES = 32 * 1024 * 1024;
/** After this many pages have been opened, PDF.js is told to let go of what it keeps for them. */
const DEFAULT_CLEANUP_AFTER_PAGES = 48;
/** An outline longer than this is cut off rather than resolved entry by entry. */
const MAX_OUTLINE_ITEMS = 2000;

export interface PdfSessionEvents {
  onDocumentLoaded?: (info: { numPages: number }) => void;
  /** `position` is the 1-based page number in the book. */
  onPageLoaded?: (position: number) => void;
  onPageError?: (error: FlipBookError) => void;
}

export interface PdfSessionSnapshot {
  readonly status: "loading" | "password" | "ready" | "error";
  /** 0..1 while downloading, `null` when the size is unknown. */
  readonly progress: number | null;
  readonly numPages: number;
  /** Size of page 1 in PDF points. The viewer uses its ratio for every page. */
  readonly firstPageSize: { readonly width: number; readonly height: number } | null;
  readonly error: FlipBookError | null;
  readonly passwordReason: PasswordReason | null;
  /** Increases every time the document asks for a password. */
  readonly passwordRequest: number;
}

export interface PdfSessionDeps {
  id: string;
  source: PdfSource;
  options: PdfOptions;
  cache: PageCache<RenderedPage>;
  /** Separate, larger cache of small renders for the thumbnail list. */
  thumbnailCache?: PageCache<RenderedPage>;
  events: () => PdfSessionEvents;
  createCanvas?: CanvasFactory;
  getDevicePixelRatio?: () => number;
}

/** Handle for a thumbnail that may no longer be wanted. Cancelling a queued render drops it. */
export interface ThumbnailRequest {
  promise: Promise<RenderedPage>;
  cancel(): void;
}

interface Job {
  key: string;
  kind: "page" | "thumb";
  cache: PageCache<RenderedPage>;
  /** Thumbnail requests still interested in the result. */
  waiters: number;
  docPage: number;
  scale: number;
  /** Where the page sits in the book. Used to rank work by distance from the reader. */
  position: number;
  prefetch: boolean;
  running: boolean;
  controller: AbortController;
  promise: Promise<RenderedPage>;
  resolve: (page: RenderedPage) => void;
  reject: (reason: unknown) => void;
}

const noop = (): void => undefined;

function asRuntimeError(error: FlipBookError): FlipBookRuntimeError {
  return new FlipBookRuntimeError(error.code, error.message, {
    ...(error.cause !== undefined ? { cause: error.cause } : {}),
    ...(error.page !== undefined ? { page: error.page } : {}),
  });
}

/**
 * One open PDF: loads the document, answers password prompts, and renders
 * pages on demand.
 *
 * Rendering is queued. At most `maxConcurrentRenders` pages draw at once;
 * pages on screen go first, then the nearest prefetches. Work that scrolls
 * out of range is dropped, and `destroy()` cancels everything in flight and
 * terminates the PDF.js worker.
 */
export class PdfSession {
  readonly id: string;
  private readonly source: PdfSource;
  private readonly options: PdfOptions;
  private readonly cache: PageCache<RenderedPage>;
  private readonly thumbnailCache: PageCache<RenderedPage> | null;
  private readonly events: () => PdfSessionEvents;
  private readonly createCanvas: CanvasFactory;
  private readonly getDevicePixelRatio: () => number;

  private snapshot: PdfSessionSnapshot = {
    status: "loading",
    progress: null,
    numPages: 0,
    firstPageSize: null,
    error: null,
    passwordReason: null,
    passwordRequest: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly jobs = new Map<string, Job>();
  private running = 0;
  private opened = false;
  private destroyed = false;
  private task: PdfLoadingTask | null = null;
  private doc: PdfDocumentProxy | null = null;
  /** Least recently used first: reading a page moves it to the end. */
  private readonly texts = new Map<number, PageText>();
  private textBytes = 0;
  /** Pages opened since PDF.js was last told to let go of what it keeps for them. */
  private touched = 0;
  /** Reads of text, links and print renders in flight. They share the document with the queue. */
  private busy = 0;
  /** Set while PDF.js is cleaning up, during which nothing may be drawn or opened. */
  private cleaning: Promise<void> | null = null;
  private readonly textLoads = new Map<number, Promise<PageText | null>>();
  private readonly links = new Map<number, Promise<PdfPageLink[]>>();
  private outline: Promise<PdfOutlineItem[]> | null = null;
  private passwordUpdate: ((password: string) => void) | null = null;
  private passwordCancelled = false;

  constructor(deps: PdfSessionDeps) {
    this.id = deps.id;
    this.source = deps.source;
    this.options = deps.options;
    this.cache = deps.cache;
    this.thumbnailCache = deps.thumbnailCache ?? null;
    this.events = deps.events;
    this.createCanvas = deps.createCanvas ?? defaultCanvasFactory;
    this.getDevicePixelRatio =
      deps.getDevicePixelRatio ??
      (() => (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
  }

  // ---- state ---------------------------------------------------------------

  readonly getSnapshot = (): PdfSessionSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<PdfSessionSnapshot>): void {
    if (this.destroyed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  // ---- loading -------------------------------------------------------------

  /** Starts loading. Safe to call more than once. */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const pdfjs = await loadPdfjs(this.options);
      if (this.destroyed) return;
      const init = await resolveDocumentInit(this.source, this.options);
      if (this.destroyed) return;

      const task = pdfjs.getDocument(init);
      this.task = task;
      task.onProgress = ({ loaded, total }) => {
        this.update({ progress: total && total > 0 ? Math.min(1, loaded / total) : null });
      };
      task.onPassword = (update, reason) => {
        this.passwordUpdate = update;
        this.update({
          status: "password",
          passwordReason: reason === NEED_PASSWORD ? "needed" : "incorrect",
          passwordRequest: this.snapshot.passwordRequest + 1,
        });
      };

      const doc = await task.promise;
      if (this.destroyed) {
        // `destroy()` already stopped the task, but the document may have arrived first.
        void Promise.resolve(task.destroy()).catch(noop);
        return;
      }
      this.doc = doc;

      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      if (this.destroyed) return;

      this.update({
        status: "ready",
        progress: 1,
        numPages: doc.numPages,
        firstPageSize: { width: viewport.width, height: viewport.height },
        error: null,
        passwordReason: null,
      });
      this.events().onDocumentLoaded?.({ numPages: doc.numPages });
    } catch (reason) {
      if (this.destroyed) return;
      this.update({
        status: "error",
        error: this.passwordCancelled
          ? { code: "PASSWORD_REQUIRED", message: "A password is required to open this PDF." }
          : mapPdfError(reason, "PDF_LOAD_FAILED"),
        passwordReason: null,
      });
    }
  }

  /** Answers a password prompt. `null` cancels, which ends in a `PASSWORD_REQUIRED` error. */
  submitPassword(password: string | null): void {
    const update = this.passwordUpdate;
    if (!update || this.destroyed) return;
    this.passwordUpdate = null;
    if (password === null) {
      this.passwordCancelled = true;
      void Promise.resolve(this.task?.destroy()).catch(noop);
      return;
    }
    this.update({ status: "loading", passwordReason: null });
    update(password);
  }

  // ---- rendering -----------------------------------------------------------

  /** Render scale for a page slot `cssWidth` wide, or `null` until the PDF is loaded. */
  scaleFor(cssWidth: number): number | null {
    const size = this.snapshot.firstPageSize;
    if (this.snapshot.status !== "ready" || !size) return null;
    return chooseRenderScale({
      baseWidth: size.width,
      baseHeight: size.height,
      cssWidth,
      devicePixelRatio: Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, this.getDevicePixelRatio())),
      requested: this.options.renderScale ?? "auto",
      maxPixels: this.options.maxCanvasPixels ?? DEFAULT_MAX_PIXELS,
    });
  }

  /** Cache key for a page at the scale that fits `cssWidth`. */
  keyFor(docPage: number, cssWidth: number): string | null {
    const scale = this.scaleFor(cssWidth);
    return scale === null ? null : this.keyAt(docPage, scale);
  }

  private keyAt(docPage: number, scale: number): string {
    return `${this.id}:${docPage}:${scale.toFixed(3)}`;
  }

  /**
   * A cached render of the page. `exact` is false when only another
   * resolution is cached, which still makes a good placeholder.
   */
  peek(docPage: number, cssWidth: number): { render: RenderedPage; exact: boolean } | null {
    const scale = this.scaleFor(cssWidth);
    if (scale === null) return null;

    const exact = this.cache.get(this.keyAt(docPage, scale));
    if (exact) return { render: exact, exact: true };

    let best: RenderedPage | undefined;
    let bestGap = Infinity;
    for (const key of this.cache.keysWithPrefix(`${this.id}:${docPage}:`)) {
      const candidate = this.cache.peek(key);
      if (!candidate) continue;
      const gap = Math.abs(candidate.scale - scale);
      if (gap < bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }
    return best ? { render: best, exact: false } : null;
  }

  /**
   * Renders a page, or returns the cached render. Concurrent requests for
   * the same page and scale share one render. Rejects with a
   * `CancelledError` if the work is dropped.
   */
  request(
    docPage: number,
    options: { position: number; cssWidth: number; prefetch?: boolean },
  ): Promise<RenderedPage> {
    if (this.destroyed) return Promise.reject(new CancelledError());
    const scale = this.scaleFor(options.cssWidth);
    if (scale === null || !this.doc) {
      return Promise.reject(
        new FlipBookRuntimeError("PAGE_RENDER_FAILED", "The PDF is not ready to render pages."),
      );
    }
    if (docPage < 1 || docPage > this.snapshot.numPages) {
      return Promise.reject(
        new FlipBookRuntimeError("INVALID_ARGUMENT", `Page ${docPage} is outside the document.`),
      );
    }

    const key = this.keyAt(docPage, scale);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);

    const existing = this.jobs.get(key);
    // A job that was just stopped is still unwinding; the reader has come back, so start afresh.
    if (existing && !existing.controller.signal.aborted) {
      if (!options.prefetch) existing.prefetch = false;
      existing.position = options.position;
      return existing.promise;
    }

    let resolve!: (page: RenderedPage) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<RenderedPage>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Prefetch results are often never awaited; rejections must not surface as unhandled.
    promise.catch(noop);

    this.jobs.set(key, {
      key,
      kind: "page",
      cache: this.cache,
      waiters: 0,
      docPage,
      scale,
      position: options.position,
      prefetch: options.prefetch ?? false,
      running: false,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
    });
    this.pump();
    return promise;
  }

  /**
   * Drops prefetches whose page is now outside `from..to`: queued ones are forgotten, and one
   * that is already drawing is stopped, so a reader who jumps far away does not wait behind
   * pages they have left. A page that was ever asked for by a view is not a prefetch and is left
   * to finish.
   */
  cancelOutside(from: number, to: number): void {
    for (const job of [...this.jobs.values()]) {
      if (!job.prefetch || job.kind !== "page") continue;
      if (job.position >= from && job.position <= to) continue;
      if (job.running) {
        job.controller.abort();
        continue;
      }
      this.jobs.delete(job.key);
      job.reject(new CancelledError());
    }
  }

  private pump(): void {
    // PDF.js must not draw while it is cleaning up; the queue resumes when it is done.
    if (this.cleaning) return;
    const limit = this.options.maxConcurrentRenders ?? DEFAULT_CONCURRENCY;
    while (!this.destroyed && this.running < limit) {
      const next = this.pickNext();
      if (!next) return;
      void this.run(next);
    }
  }

  /** Pages on screen first, then the nearest to the reader. */
  private pickNext(): Job | null {
    const focus = this.cache.getFocus();
    let best: Job | null = null;
    let bestRank = Infinity;
    for (const job of this.jobs.values()) {
      if (job.running) continue;
      const base = job.kind === "thumb" ? 2_000_000 : job.prefetch ? 1_000_000 : 0;
      const rank = base + Math.abs(job.position - focus);
      if (rank < bestRank) {
        best = job;
        bestRank = rank;
      }
    }
    return best;
  }

  private async run(job: Job): Promise<void> {
    job.running = true;
    this.running += 1;
    let page: PdfPageProxy | null = null;
    try {
      const doc = this.doc;
      if (!doc) throw new CancelledError();
      page = await doc.getPage(job.docPage);
      if (job.controller.signal.aborted) throw new CancelledError();

      const rendered = await renderPdfPage(page, job.scale, {
        createCanvas: this.createCanvas,
        signal: job.controller.signal,
      });
      if (job.controller.signal.aborted) {
        rendered.canvas.width = 0;
        rendered.canvas.height = 0;
        throw new CancelledError();
      }

      job.cache.set(job.key, rendered, { position: job.position, bytes: rendered.bytes });
      this.forget(job);
      job.resolve(rendered);
      if (job.kind === "page") this.events().onPageLoaded?.(job.position);
    } catch (reason) {
      this.forget(job);
      if (isCancellation(reason) || this.destroyed) {
        job.reject(new CancelledError());
      } else {
        const error = { ...mapPdfError(reason, "PAGE_RENDER_FAILED"), page: job.position };
        job.reject(asRuntimeError(error));
        if (job.kind === "page") this.events().onPageError?.(error);
      }
    } finally {
      this.running -= 1;
      const stillUsed = [...this.jobs.values()].some((j) => j.running && j.docPage === job.docPage);
      if (page && !stillUsed) {
        try {
          page.cleanup?.();
        } catch {
          // Releasing page resources is best effort.
        }
      }
      if (page) this.touched += 1;
      this.pump();
      this.cleanUpWhenQuiet();
    }
  }

  /** Removes a job from the queue, unless a newer job has already taken its place. */
  private forget(job: Job): void {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
  }

  // ---- memory --------------------------------------------------------------------

  /**
   * Runs work that talks to the document. It waits out a cleanup, and while it runs no cleanup
   * can start. `counted` work opened a page and so brings the next cleanup closer.
   */
  private async withDocument<T>(work: () => Promise<T>, counted = true): Promise<T> {
    while (this.cleaning) await this.cleaning;
    if (this.destroyed) throw new CancelledError();
    this.busy += 1;
    try {
      return await work();
    } finally {
      this.busy -= 1;
      if (counted) this.touched += 1;
      this.cleanUpWhenQuiet();
    }
  }

  /**
   * PDF.js keeps something for every page it has opened, in the page and in its worker, however
   * small our own caches are. Once enough pages have gone by and nothing is drawing, tell it to
   * let go. This is what the PDF.js viewer does when its render queue goes idle.
   */
  private cleanUpWhenQuiet(): void {
    const every = this.options.cleanupAfterPages ?? DEFAULT_CLEANUP_AFTER_PAGES;
    const doc = this.doc;
    if (every <= 0 || this.touched < every || !doc?.cleanup) return;
    if (this.destroyed || this.cleaning) return;
    if (this.running > 0 || this.jobs.size > 0 || this.busy > 0) return;

    this.touched = 0;
    let started: Promise<void>;
    try {
      started = Promise.resolve(doc.cleanup());
    } catch {
      started = Promise.resolve();
    }
    const done: Promise<void> = started
      .catch(noop)
      .then(() => {
        if (this.cleaning === done) this.cleaning = null;
        this.pump();
      });
    this.cleaning = done;
  }

  /** What this document is holding for search, in pages and bytes. */
  getMemoryStats(): { textPages: number; textBytes: number } {
    return { textPages: this.texts.size, textBytes: this.textBytes };
  }

  /** Bytes one canvas of this document takes at the size that fits `cssWidth`, or 0 if not ready. */
  estimateBytes(cssWidth: number): number {
    const size = this.snapshot.firstPageSize;
    const scale = this.scaleFor(cssWidth);
    if (!size || scale === null) return 0;
    return Math.ceil(size.width * scale) * Math.ceil(size.height * scale) * 4;
  }

  // ---- thumbnails ------------------------------------------------------------

  private thumbnailScale(cssWidth: number): number | null {
    const size = this.snapshot.firstPageSize;
    if (this.snapshot.status !== "ready" || !size) return null;
    const dpr = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, this.getDevicePixelRatio()));
    const wanted = (cssWidth * dpr) / size.width;
    // Sixteenth steps: thumbnails are far smaller than pages, so the page
    // render's quarter steps and 0.25 floor would make them several times too big.
    const stepped = Math.max(1 / 16, Math.ceil((Number.isFinite(wanted) && wanted > 0 ? wanted : 1) * 16) / 16);
    return Math.min(stepped, Math.sqrt(THUMBNAIL_MAX_PIXELS / (size.width * size.height)));
  }

  private thumbnailKey(docPage: number, scale: number): string {
    return `${this.id}:t${docPage}:${scale.toFixed(3)}`;
  }

  /** A cached thumbnail, or null. Reads do not count as use. */
  peekThumbnail(docPage: number, cssWidth: number): RenderedPage | null {
    const scale = this.thumbnailScale(cssWidth);
    if (scale === null || !this.thumbnailCache) return null;
    return this.thumbnailCache.get(this.thumbnailKey(docPage, scale)) ?? null;
  }

  /**
   * Renders a small version of a page for the thumbnail list. Thumbnails queue
   * behind real pages, and a request that is cancelled before it starts costs
   * nothing, so scrolling a long list quickly does not render pages nobody saw.
   */
  requestThumbnail(
    docPage: number,
    options: { position: number; cssWidth: number },
  ): ThumbnailRequest {
    const unavailable = (error: FlipBookRuntimeError): ThumbnailRequest => {
      const promise = Promise.reject(error);
      promise.catch(noop);
      return { promise, cancel: noop };
    };
    const cache = this.thumbnailCache;
    const scale = this.thumbnailScale(options.cssWidth);
    if (this.destroyed) return unavailable(new CancelledError() as unknown as FlipBookRuntimeError);
    if (!cache || scale === null || !this.doc) {
      return unavailable(
        new FlipBookRuntimeError("PAGE_RENDER_FAILED", "The PDF is not ready to render thumbnails."),
      );
    }
    if (docPage < 1 || docPage > this.snapshot.numPages) {
      return unavailable(
        new FlipBookRuntimeError("INVALID_ARGUMENT", `Page ${docPage} is outside the document.`),
      );
    }

    const key = this.thumbnailKey(docPage, scale);
    const cached = cache.get(key);
    if (cached) return { promise: Promise.resolve(cached), cancel: noop };

    let job = this.jobs.get(key);
    if (!job) {
      let resolve!: (page: RenderedPage) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<RenderedPage>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(noop);
      job = {
        key,
        kind: "thumb",
        cache,
        waiters: 0,
        docPage,
        scale,
        position: options.position,
        prefetch: false,
        running: false,
        controller: new AbortController(),
        promise,
        resolve,
        reject,
      };
      this.jobs.set(key, job);
    }
    job.waiters += 1;
    const owned = job;
    this.pump();

    let cancelled = false;
    return {
      promise: owned.promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        owned.waiters -= 1;
        if (owned.waiters <= 0 && !owned.running && this.jobs.get(key) === owned) {
          this.jobs.delete(key);
          owned.reject(new CancelledError());
        }
      },
    };
  }

  // ---- printing --------------------------------------------------------------

  /**
   * Renders a page straight to a new canvas, bypassing the queue and the
   * cache. Used for printing, where pages are drawn one at a time at high
   * resolution and handed over immediately.
   */
  async renderOnce(docPage: number, scale: number, signal?: AbortSignal): Promise<RenderedPage> {
    const doc = this.doc;
    if (this.destroyed || !doc) throw new CancelledError();
    const size = this.snapshot.firstPageSize;
    const capped = size
      ? Math.min(
          scale,
          Math.sqrt((this.options.maxCanvasPixels ?? DEFAULT_MAX_PIXELS) / (size.width * size.height)),
        )
      : scale;
    return this.withDocument(async () => {
      const page = await doc.getPage(docPage);
      try {
        return await renderPdfPage(page, capped, {
          createCanvas: this.createCanvas,
          ...(signal ? { signal } : {}),
        });
      } finally {
        try {
          page.cleanup?.();
        } catch {
          // Best effort.
        }
      }
    });
  }

  // ---- text, links and contents --------------------------------------------

  /** Maps a point or box in PDF user space to a rectangle in fractions of the page. */
  private rectMapper(viewport: PdfViewport): (x: number, y: number, w: number, h: number) => TextRect {
    const m = viewport.transform ?? [1, 0, 0, -1, 0, viewport.height];
    const apply = (x: number, y: number): [number, number] => [
      (m[0] as number) * x + (m[2] as number) * y + (m[4] as number),
      (m[1] as number) * x + (m[3] as number) * y + (m[5] as number),
    ];
    const { width: vw, height: vh } = viewport;
    return (x, y, w, h) => {
      const [x1, y1] = apply(x, y);
      const [x2, y2] = apply(x + w, y + h);
      return {
        x: Math.min(x1, x2) / vw,
        y: Math.min(y1, y2) / vh,
        width: Math.abs(x2 - x1) / vw,
        height: Math.abs(y2 - y1) / vh,
      };
    };
  }

  /**
   * The searchable text of a page, with where each run sits. Cached, so
   * searching again costs nothing, and concurrent requests share one read.
   * Resolves null for a page without text support.
   */
  getPageText(docPage: number, signal?: AbortSignal): Promise<PageText | null> {
    if (this.destroyed) return Promise.reject(new CancelledError());
    const cached = this.texts.get(docPage);
    if (cached) {
      // Reading a page makes it the most recently used.
      this.texts.delete(docPage);
      this.texts.set(docPage, cached);
      return Promise.resolve(cached);
    }
    const pending = this.textLoads.get(docPage);
    if (pending) return pending;

    const load = this.withDocument(async (): Promise<PageText | null> => {
      const doc = this.doc;
      if (!doc) throw new CancelledError();
      if (docPage < 1 || docPage > this.snapshot.numPages) return null;
      const page = await doc.getPage(docPage);
      try {
        if (signal?.aborted || this.destroyed) throw new CancelledError();
        const content = await page.getTextContent?.();
        if (!content) return null;
        if (signal?.aborted || this.destroyed) throw new CancelledError();
        const text = buildPageText(content.items, this.rectMapper(page.getViewport({ scale: 1 })));
        this.rememberText(docPage, text);
        return text;
      } finally {
        try {
          page.cleanup?.();
        } catch {
          // Best effort.
        }
      }
    });
    this.textLoads.set(docPage, load);
    const done = (): void => {
      this.textLoads.delete(docPage);
    };
    load.then(done, done);
    return load;
  }

  private rememberText(docPage: number, text: PageText): void {
    const previous = this.texts.get(docPage);
    if (previous) this.textBytes -= estimateTextBytes(previous);
    this.texts.delete(docPage);
    this.texts.set(docPage, text);
    this.textBytes += estimateTextBytes(text);

    const budget = this.options.maxTextCacheBytes ?? DEFAULT_TEXT_CACHE_BYTES;
    // Oldest first. The page just read always stays, even if it alone is over budget.
    for (const [key, old] of this.texts) {
      if (this.textBytes <= budget || this.texts.size <= 1) break;
      if (key === docPage) continue;
      this.texts.delete(key);
      this.textBytes -= estimateTextBytes(old);
    }
  }

  /** Works out which page of this PDF a destination points at, or null. */
  private async resolveDestination(dest: unknown): Promise<number | null> {
    const doc = this.doc;
    if (!doc) return null;
    try {
      const explicit = typeof dest === "string" ? await doc.getDestination?.(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const target: unknown = explicit[0];
      if (typeof target === "number") return target + 1;
      const index = await doc.getPageIndex?.(target);
      return typeof index === "number" ? index + 1 : null;
    } catch {
      return null;
    }
  }

  /**
   * The links on a page, as rectangles in fractions of the page. Web links
   * are checked against a short list of safe schemes; internal links are
   * resolved to a page of this PDF. Cached.
   */
  getLinks(docPage: number): Promise<PdfPageLink[]> {
    const cached = this.links.get(docPage);
    if (cached) return cached;
    const load = this.withDocument(async (): Promise<PdfPageLink[]> => {
      const doc = this.doc;
      if (!doc || docPage < 1 || docPage > this.snapshot.numPages) return [];
      const page = await doc.getPage(docPage);
      try {
        const annotations = await page.getAnnotations?.({ intent: "display" });
        if (!annotations) return [];
        const toRect = this.rectMapper(page.getViewport({ scale: 1 }));
        const result: PdfPageLink[] = [];
        for (const annotation of annotations) {
          const r = annotation.rect;
          if (annotation.subtype !== "Link" || !r || r.length < 4) continue;
          const [x1, y1, x2, y2] = r as [number, number, number, number];
          const rect = toRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          const url = safeUrl(annotation.url);
          if (url) {
            result.push({ rect, kind: "url", page: null, url, newWindow: annotation.newWindow ?? true });
          } else if (annotation.dest !== undefined && annotation.dest !== null) {
            const target = await this.resolveDestination(annotation.dest);
            if (target !== null) result.push({ rect, kind: "page", page: target, url: null, newWindow: false });
          }
        }
        return result;
      } finally {
        try {
          page.cleanup?.();
        } catch {
          // Best effort.
        }
      }
    });
    this.links.set(docPage, load);
    // A failure is not remembered, so a later request can try again.
    load.catch(() => {
      if (this.links.get(docPage) === load) this.links.delete(docPage);
    });
    return load;
  }

  /** The PDF's own table of contents, with pages resolved. Empty when it has none. */
  getOutline(): Promise<PdfOutlineItem[]> {
    if (this.outline) return this.outline;
    const load = this.withDocument(async (): Promise<PdfOutlineItem[]> => {
      const doc = this.doc;
      const raw = (await doc?.getOutline?.()) ?? null;
      if (!raw) return [];
      let remaining = MAX_OUTLINE_ITEMS;
      const convert = async (items: readonly PdfRawOutlineItem[]): Promise<PdfOutlineItem[]> => {
        const out: PdfOutlineItem[] = [];
        for (const item of items) {
          if (remaining <= 0) break;
          remaining -= 1;
          const url = safeUrl(item.url);
          out.push({
            title: item.title,
            page: url ? null : item.dest === undefined || item.dest === null ? null : await this.resolveDestination(item.dest),
            url,
            bold: item.bold ?? false,
            italic: item.italic ?? false,
            items: item.items ? await convert(item.items) : [],
          });
        }
        return out;
      };
      return convert(raw);
    }, false);
    this.outline = load;
    load.catch(() => {
      if (this.outline === load) this.outline = null;
    });
    return load;
  }

  // ---- teardown ------------------------------------------------------------

  /**
   * Cancels queued and running renders, drops this document's cached
   * canvases, and terminates the PDF.js worker. Safe to call repeatedly.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const job of [...this.jobs.values()]) {
      job.controller.abort();
      if (!job.running) job.reject(new CancelledError());
    }
    this.jobs.clear();
    this.passwordUpdate = null;
    this.cleaning = null;

    const teardown = this.task ? this.task.destroy() : this.doc?.destroy?.();
    void Promise.resolve(teardown).catch(noop);
    this.task = null;
    this.doc = null;

    this.cache.deleteWithPrefix(`${this.id}:`);
    this.thumbnailCache?.deleteWithPrefix(`${this.id}:`);
    this.texts.clear();
    this.textBytes = 0;
    this.textLoads.clear();
    this.links.clear();
    this.outline = null;
    this.listeners.clear();
  }
}
