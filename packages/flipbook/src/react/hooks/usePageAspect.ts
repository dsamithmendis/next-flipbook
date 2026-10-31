"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_PAGE_ASPECT, parseAspectRatio, type AspectRatioProp } from "../../core/layout/sizing.js";
import { toFlipBookError, type FlipBookError } from "../../core/errors.js";
import type { ImageLoader } from "../../image/loader.js";
import type { PdfManager } from "../../pdf/manager.js";
import type { FlipBookPage } from "../../types/index.js";

/**
 * Resolves the page aspect ratio (width / height).
 *
 * Order of preference: the `aspectRatio` prop, then the first page that has a
 * size of its own: an image (declared `width` and `height`, or its natural
 * size) or a PDF page (the document's first-page size). Books made only of
 * custom pages fall back to 3:4. `aspect` is `null` until that size is known,
 * and `error` is set if the first image or PDF fails to load. PDF failures
 * are reported to the app by the provider; `imageError` is the part only the
 * stage knows about, so it is the part the stage reports.
 */
export function usePageAspect(
  pages: readonly FlipBookPage[],
  aspectRatio: AspectRatioProp,
  loader: ImageLoader,
  pdf: PdfManager,
): { aspect: number | null; error: FlipBookError | null; imageError: FlipBookError | null } {
  // Re-evaluate whenever a PDF finishes loading or fails.
  useSyncExternalStore(pdf.subscribe, pdf.getVersion, pdf.getVersion);

  const explicit = parseAspectRatio(aspectRatio);
  const first = pages.find((page) => page.type !== "custom");
  const image = first?.type === "image" ? first : undefined;
  const declared = image?.width && image.height ? image.width / image.height : null;
  const measureSrc = explicit === null && declared === null && image ? image.src : null;

  const [loaded, setLoaded] = useState<{ src: string; aspect: number } | null>(null);
  const [failure, setFailure] = useState<{ src: string; error: FlipBookError } | null>(null);

  useEffect(() => {
    if (measureSrc === null) return;
    let cancelled = false;
    loader.load(measureSrc).then(
      (result) => {
        if (cancelled) return;
        const aspect =
          result.width > 0 && result.height > 0 ? result.width / result.height : DEFAULT_PAGE_ASPECT;
        setLoaded({ src: measureSrc, aspect });
      },
      (reason: unknown) => {
        if (cancelled) return;
        setFailure({
          src: measureSrc,
          error: toFlipBookError(reason, {
            code: "IMAGE_LOAD_FAILED",
            message: `Failed to load image: ${measureSrc}`,
            page: 1,
          }),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [measureSrc, loader]);

  // A PDF supplies its own size once it has loaded.
  let pdfAspect: number | null = null;
  let pdfError: FlipBookError | null = null;
  if (first?.type === "pdf") {
    const snapshot = pdf.getSession(first.source)?.getSnapshot();
    if (snapshot?.status === "ready" && snapshot.firstPageSize) {
      pdfAspect = snapshot.firstPageSize.width / snapshot.firstPageSize.height;
    } else if (snapshot?.status === "error") {
      pdfError = snapshot.error;
    }
  }

  let aspect: number | null;
  if (explicit !== null) aspect = explicit;
  else if (declared !== null) aspect = declared;
  else if (first === undefined) aspect = DEFAULT_PAGE_ASPECT;
  else if (first.type === "pdf") aspect = pdfAspect;
  else aspect = loaded?.src === measureSrc ? loaded.aspect : null;

  const imageError = measureSrc !== null && failure?.src === measureSrc ? failure.error : null;
  return { aspect, error: pdfError ?? imageError, imageError };
}
