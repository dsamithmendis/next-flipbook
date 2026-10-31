/** Anything PDF.js can open. A `File` is a `Blob`. */
export type PdfSource = string | URL | Blob | ArrayBuffer | Uint8Array;

export type PasswordReason = "needed" | "incorrect";

export interface PdfOptions {
  /**
   * URL of `pdf.worker.min.mjs`. If omitted, and you have not set
   * `GlobalWorkerOptions.workerSrc` yourself, the worker is loaded from the
   * jsDelivr CDN at the installed pdfjs-dist version. Host it yourself for
   * production, offline use or a strict Content-Security-Policy.
   */
  workerSrc?: string;
  /**
   * Supplies the `pdfjs-dist` module. Use it to load the legacy build for old
   * browsers, or a build you bundle yourself:
   * `() => import("pdfjs-dist/legacy/build/pdf.mjs")`.
   */
  loadPdfjs?: () => Promise<unknown>;
  /** Pixels per PDF point, or `"auto"` to match the on-screen size and device pixel ratio. */
  renderScale?: "auto" | number;
  /** Upper bound on one page canvas. Larger renders are scaled down. Default 12,000,000. */
  maxCanvasPixels?: number;
  /** Soft memory budget for cached page canvases, in bytes. Default 192 MB. */
  maxCacheBytes?: number;
  /**
   * Memory the search index may hold, in bytes: the text of pages already read, with where each
   * word sits. The least recently used pages are dropped and read again if needed. Default 32 MB.
   */
  maxTextCacheBytes?: number;
  /**
   * PDF.js keeps something for every page it has opened, in the page and in its worker, until it
   * is told to let go. After this many pages have been drawn or read, the document is cleaned up
   * the next time nothing is drawing. Default 48. `0` never cleans up.
   */
  cleanupAfterPages?: number;
  /** Tried first for encrypted PDFs. */
  password?: string;
  withCredentials?: boolean;
  httpHeaders?: Record<string, string>;
  /** Pages rendered at once. Default 2. */
  maxConcurrentRenders?: number;
  /**
   * Extra parameters for PDF.js `getDocument`, for assets you host yourself:
   * `standardFontDataUrl`, `cMapUrl`, `cMapPacked`, `wasmUrl` and so on. The
   * source, password, `withCredentials` and `httpHeaders` set above take
   * precedence.
   */
  documentParams?: Record<string, unknown>;
}

/*
 * A minimal structural view of pdfjs-dist. Keeping our own small interfaces
 * means the code does not depend on one pdfjs-dist version, and tests can
 * substitute a fake.
 */

export interface PdfViewport {
  width: number;
  height: number;
  /** Maps PDF user space to viewport pixels. Accounts for page rotation. */
  transform?: readonly number[];
}

export interface PdfTextContent {
  items: ReadonlyArray<{
    str?: string;
    transform?: readonly number[];
    width?: number;
    height?: number;
    hasEOL?: boolean;
  }>;
}

export interface PdfAnnotation {
  subtype?: string;
  /** [x1, y1, x2, y2] in PDF user space. */
  rect?: readonly number[];
  url?: string | null;
  unsafeUrl?: string;
  dest?: unknown;
  newWindow?: boolean;
}

export interface PdfRawOutlineItem {
  title: string;
  bold?: boolean;
  italic?: boolean;
  dest?: unknown;
  url?: string | null;
  unsafeUrl?: string;
  newWindow?: boolean;
  items?: readonly PdfRawOutlineItem[];
}

export interface PdfRenderTask {
  promise: Promise<unknown>;
  cancel(): void;
}

export interface PdfPageProxy {
  getViewport(params: { scale: number }): PdfViewport;
  render(params: {
    canvas: HTMLCanvasElement;
    canvasContext?: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): PdfRenderTask;
  cleanup?(): unknown;
  getTextContent?(): Promise<PdfTextContent>;
  getAnnotations?(params?: { intent?: string }): Promise<readonly PdfAnnotation[]>;
}

export interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  /**
   * Frees what PDF.js keeps for every page it has opened, in the page and in the worker.
   * Never call it while a page is rendering.
   */
  cleanup?(keepLoadedFonts?: boolean): Promise<void>;
  /** Older PDF.js versions only. Newer ones are torn down through the loading task. */
  destroy?(): Promise<unknown> | void;
  getOutline?(): Promise<readonly PdfRawOutlineItem[] | null>;
  getDestination?(id: string): Promise<readonly unknown[] | null>;
  getPageIndex?(ref: unknown): Promise<number>;
}

/** One entry of a PDF's own table of contents (its bookmarks). Pages are 1-based within that PDF. */
export interface PdfOutlineItem {
  title: string;
  page: number | null;
  /** A web address the entry points at instead of a page, already checked as safe. */
  url: string | null;
  bold: boolean;
  italic: boolean;
  items: PdfOutlineItem[];
}

/** A clickable region of a PDF page. The rectangle is in fractions of the page. */
export interface PdfPageLink {
  rect: { x: number; y: number; width: number; height: number };
  /** `page` links jump inside the PDF; `url` links open a web address. */
  kind: "page" | "url";
  /** Page within that PDF, for `page` links. */
  page: number | null;
  url: string | null;
  newWindow: boolean;
}

export interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>;
  onPassword?: ((update: (password: string) => void, reason: number) => void) | null;
  onProgress?: ((progress: { loaded: number; total?: number }) => void) | null;
  destroy(): Promise<unknown> | void;
}

export interface PdfDocumentInit {
  [extra: string]: unknown;
  url?: string;
  data?: Uint8Array;
  password?: string;
  withCredentials?: boolean;
  httpHeaders?: Record<string, string>;
}

export interface PdfjsModule {
  version: string;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: PdfDocumentInit): PdfLoadingTask;
}
