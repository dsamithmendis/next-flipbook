import { FlipBookRuntimeError } from "../core/errors.js";
import { CancelledError, isCancellation } from "../pdf/errors.js";

/** One page ready to print. `release` frees whatever backs `src` (an object URL, say). */
export interface PrintablePage {
  src: string;
  release?: () => void;
}

export interface PrintSource {
  total: number;
  /** Prepares page `index` (0-based). Return null to skip a page that cannot be printed. */
  load(index: number, signal: AbortSignal): Promise<PrintablePage | null>;
}

/** Where printing happens. The default is a hidden iframe; tests substitute a fake. */
export interface PrintFrame {
  show(pages: readonly PrintablePage[], title: string): Promise<void>;
  /** Resolves when the print dialog has closed. */
  print(): Promise<void>;
  dispose(): void;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The document that gets printed: one image per sheet, centred and scaled to
 * fit, with no margins. It contains nothing of the interactive viewer.
 */
export function buildPrintHtml(pages: readonly { src: string }[], title: string): string {
  const sheets = pages
    .map((page) => `<div class="sheet"><img src="${escapeHtml(page.src)}" alt=""></div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.sheet { width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; break-after: page; page-break-after: always; overflow: hidden; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
</style></head><body>${sheets}</body></html>`;
}

/**
 * Prepares pages one at a time, then prints them together.
 *
 * Loading is sequential so memory stays flat however long the document is: a
 * page is rendered, converted to an image URL and its canvas dropped before
 * the next one starts. A page that fails is skipped; if nothing at all can
 * be printed the job fails. Aborting stops at once, disposes the frame and
 * releases every page.
 */
export async function printPages(
  source: PrintSource,
  options: {
    title?: string;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
  createFrame: () => PrintFrame = createIframeFrame,
): Promise<{ printed: number; skipped: number }> {
  const controller = new AbortController();
  const { signal: outer } = options;
  const forward = (): void => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", forward, { once: true });

  const pages: PrintablePage[] = [];
  let skipped = 0;
  let frame: PrintFrame | null = null;
  try {
    for (let index = 0; index < source.total; index += 1) {
      if (controller.signal.aborted) throw new CancelledError();
      let page: PrintablePage | null = null;
      try {
        page = await source.load(index, controller.signal);
      } catch (error) {
        if (isCancellation(error) || controller.signal.aborted) throw new CancelledError();
      }
      if (controller.signal.aborted) {
        page?.release?.();
        throw new CancelledError();
      }
      if (page) pages.push(page);
      else skipped += 1;
      options.onProgress?.(index + 1, source.total);
    }
    if (pages.length === 0) {
      throw new FlipBookRuntimeError("PRINT_FAILED", "There was nothing to print.");
    }

    frame = createFrame();
    await frame.show(pages, options.title ?? "Document");
    if (controller.signal.aborted) throw new CancelledError();
    const closed = frame.print();
    const onAbort = (): void => frame?.dispose();
    controller.signal.addEventListener("abort", onAbort, { once: true });
    await closed;
    controller.signal.removeEventListener("abort", onAbort);
    return { printed: pages.length, skipped };
  } finally {
    outer?.removeEventListener("abort", forward);
    frame?.dispose();
    for (const page of pages) {
      try {
        page.release?.();
      } catch {
        // Releasing is best effort.
      }
    }
  }
}

const IMAGE_WAIT_MS = 20_000;
const DIALOG_WAIT_MS = 120_000;

/** Prints in a hidden same-origin iframe, so the page behind is untouched. */
export function createIframeFrame(
  timeouts: { imageWaitMs?: number; dialogWaitMs?: number } = {},
): PrintFrame {
  const imageWaitMs = timeouts.imageWaitMs ?? IMAGE_WAIT_MS;
  const dialogWaitMs = timeouts.dialogWaitMs ?? DIALOG_WAIT_MS;
  let iframe: HTMLIFrameElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finish: (() => void) | null = null;

  return {
    async show(pages, title) {
      if (typeof document === "undefined") {
        throw new FlipBookRuntimeError("UNSUPPORTED_ENVIRONMENT", "Printing only works in a browser.");
      }
      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      if (!doc) throw new FlipBookRuntimeError("PRINT_FAILED", "Could not prepare the print document.");
      doc.open();
      doc.write(buildPrintHtml(pages, title));
      doc.close();

      const loading = Array.from(doc.images).map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) resolve();
            else {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }
          }),
      );
      await Promise.race([
        Promise.all(loading),
        new Promise<void>((resolve) => setTimeout(resolve, imageWaitMs)),
      ]);
    },

    print() {
      return new Promise<void>((resolve) => {
        const win = iframe?.contentWindow;
        if (!win) {
          resolve();
          return;
        }
        let done = false;
        finish = () => {
          if (done) return;
          done = true;
          win.removeEventListener("afterprint", finish as () => void);
          if (timer) clearTimeout(timer);
          resolve();
        };
        win.addEventListener("afterprint", finish);
        // Some browsers never fire afterprint; do not hold the iframe forever.
        timer = setTimeout(finish, dialogWaitMs);
        win.focus();
        win.print();
      });
    },

    dispose() {
      finish?.();
      if (timer) clearTimeout(timer);
      timer = null;
      iframe?.remove();
      iframe = null;
    },
  };
}

/** Converts a canvas to an object URL (JPEG), then shrinks the canvas so its memory is freed at once. */
export async function canvasToPrintable(
  canvas: HTMLCanvasElement,
  quality = 0.92,
): Promise<PrintablePage> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new FlipBookRuntimeError("PRINT_FAILED", "A page could not be converted for printing.");
  const url = URL.createObjectURL(blob);
  return { src: url, release: () => URL.revokeObjectURL(url) };
}
