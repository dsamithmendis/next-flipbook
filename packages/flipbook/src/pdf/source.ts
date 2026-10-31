import { FlipBookRuntimeError } from "../core/errors.js";
import type { PdfDocumentInit, PdfOptions, PdfSource } from "./types.js";

const identities = new WeakMap<object, number>();
let nextIdentity = 1;

/** Stable identity for a source: equal URLs match, binary sources match by reference. */
export function sourceKey(source: PdfSource): string {
  if (typeof source === "string") return `url:${source}`;
  if (source instanceof URL) return `url:${source.href}`;
  let id = identities.get(source);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(source, id);
  }
  return `obj:${id}`;
}

const tag = (value: unknown): string => Object.prototype.toString.call(value);

/**
 * Turns a source into `getDocument` parameters.
 *
 * Binary sources are copied, because PDF.js transfers the buffer to its
 * worker, which would detach the caller's own `ArrayBuffer`. Blobs and Files
 * are read into memory directly, so no object URL is created and none needs
 * revoking.
 */
export async function resolveDocumentInit(
  source: PdfSource,
  options: PdfOptions,
): Promise<PdfDocumentInit> {
  const init: PdfDocumentInit = { ...options.documentParams };
  if (options.password !== undefined) init.password = options.password;
  if (options.withCredentials !== undefined) init.withCredentials = options.withCredentials;
  if (options.httpHeaders !== undefined) init.httpHeaders = options.httpHeaders;

  if (typeof source === "string") return { ...init, url: source };
  if (source instanceof URL) return { ...init, url: source.href };

  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return { ...init, data: new Uint8Array(await source.arrayBuffer()) };
  }
  if (tag(source) === "[object ArrayBuffer]") {
    return { ...init, data: new Uint8Array((source as ArrayBuffer).slice(0)) };
  }
  if (ArrayBuffer.isView(source)) {
    const view = source as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return { ...init, data: copy };
  }

  throw new FlipBookRuntimeError(
    "UNSUPPORTED_SOURCE",
    "A PDF source must be a URL string, URL, Blob, File, ArrayBuffer or Uint8Array.",
  );
}
