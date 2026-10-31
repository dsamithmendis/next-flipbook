import { FlipBookRuntimeError } from "../core/errors.js";
import type { PdfOptions, PdfjsModule } from "./types.js";

type Loader = () => Promise<unknown>;

// pdfjs-dist is loaded on demand into its own chunk, so image-only books
// never download it. The module is only ever imported in the browser.
const defaultLoader: Loader = () => import("pdfjs-dist");

const loaded = new WeakMap<Loader, Promise<PdfjsModule>>();

/** Where the worker is fetched from when the app does not configure one. */
export function cdnWorkerSrc(version: string): string {
  return `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}

function isPdfjsModule(value: unknown): value is PdfjsModule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PdfjsModule>;
  return typeof candidate.getDocument === "function" && candidate.GlobalWorkerOptions !== undefined;
}

function toModule(value: unknown): PdfjsModule {
  if (isPdfjsModule(value)) return value;
  const fallback = (value as { default?: unknown } | null)?.default;
  if (isPdfjsModule(fallback)) return fallback;
  throw new FlipBookRuntimeError(
    "PDF_LOAD_FAILED",
    "`loadPdfjs` must resolve to the pdfjs-dist module (it needs getDocument and GlobalWorkerOptions).",
  );
}

/** Points PDF.js at a worker. An explicit option wins; otherwise an existing setting is kept. */
export function configureWorker(pdfjs: PdfjsModule, workerSrc: string | undefined): void {
  const options = pdfjs.GlobalWorkerOptions;
  if (workerSrc) options.workerSrc = workerSrc;
  else if (!options.workerSrc) options.workerSrc = cdnWorkerSrc(pdfjs.version);
}

/**
 * Loads pdfjs-dist once per loader and configures its worker. A failed load
 * is not remembered, so a later attempt can retry.
 */
export function loadPdfjs(
  options: Pick<PdfOptions, "workerSrc" | "loadPdfjs"> = {},
): Promise<PdfjsModule> {
  const loader: Loader = options.loadPdfjs ?? defaultLoader;
  let promise = loaded.get(loader);
  if (!promise) {
    promise = loader().then(toModule);
    promise.catch(() => {
      loaded.delete(loader);
    });
    loaded.set(loader, promise);
  }
  return promise.then((pdfjs) => {
    configureWorker(pdfjs, options.workerSrc);
    return pdfjs;
  });
}
