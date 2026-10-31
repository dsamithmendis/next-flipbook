import type { FlipBookPage, FlipBookPageInput, ImagePage, PdfPage } from "../types/index.js";

export function normalizePages(input: readonly FlipBookPageInput[]): FlipBookPage[] {
  return input.map((page) => (typeof page === "string" ? { type: "image", src: page } : page));
}

export function isImagePage(page: FlipBookPage | undefined): page is ImagePage {
  return page?.type === "image";
}

export function isPdfPage(page: FlipBookPage | undefined): page is PdfPage {
  return page?.type === "pdf";
}
