import { FlipBookRuntimeError } from "../core/errors.js";
import type { PdfSource } from "../pdf/types.js";

/** Object URLs stay alive briefly after the click: some browsers read them asynchronously. */
const REVOKE_AFTER_MS = 30_000;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Releases every object URL still waiting to be revoked. Call it when the viewer unmounts. */
export function revokePendingDownloads(): void {
  for (const [url, timer] of pending) {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
  pending.clear();
}

/** A sensible file name for a source: the explicit one, the File's own, the URL's, or `document.pdf`. */
export function filenameFor(source: PdfSource, explicit?: string): string {
  if (explicit) return explicit;
  if (typeof File !== "undefined" && source instanceof File && source.name) return source.name;
  if (typeof source === "string" || source instanceof URL) {
    try {
      const base = typeof document === "undefined" ? "http://localhost/" : document.baseURI;
      const last = new URL(String(source), base).pathname.split("/").filter(Boolean).pop();
      if (last && /\.pdf$/i.test(last)) return decodeURIComponent(last);
    } catch {
      // Fall through to the default.
    }
  }
  return "document.pdf";
}

function click(anchor: HTMLAnchorElement): void {
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Hands a PDF to the browser as a download.
 *
 * A same-origin URL downloads directly. A cross-origin URL cannot be forced
 * to download (browsers ignore the attribute), so it opens in a new tab
 * rather than navigating away from the viewer. A Blob, File, ArrayBuffer or
 * Uint8Array is saved from memory through an object URL that is revoked
 * afterwards.
 */
export async function downloadSource(source: PdfSource, options: { filename?: string } = {}): Promise<void> {
  if (typeof document === "undefined") {
    throw new FlipBookRuntimeError("UNSUPPORTED_ENVIRONMENT", "Downloads only work in a browser.");
  }
  const filename = filenameFor(source, options.filename);
  const anchor = document.createElement("a");
  anchor.rel = "noopener";

  if (typeof source === "string" || source instanceof URL) {
    const url = new URL(String(source), document.baseURI);
    anchor.href = url.href;
    if (url.origin === location.origin) anchor.download = filename;
    else anchor.target = "_blank";
    click(anchor);
    return;
  }

  let blob: Blob;
  if (typeof Blob !== "undefined" && source instanceof Blob) blob = source;
  else if (ArrayBuffer.isView(source) || Object.prototype.toString.call(source) === "[object ArrayBuffer]") {
    blob = new Blob([source as BlobPart], { type: "application/pdf" });
  } else {
    throw new FlipBookRuntimeError("DOWNLOAD_FAILED", "This source cannot be downloaded.");
  }

  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = filename;
  click(anchor);
  pending.set(
    url,
    setTimeout(() => {
      URL.revokeObjectURL(url);
      pending.delete(url);
    }, REVOKE_AFTER_MS),
  );
}
