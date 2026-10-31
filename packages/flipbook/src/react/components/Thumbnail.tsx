"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { RenderedPage } from "../../pdf/renderer.js";
import type { FlipBookPage, PdfPage } from "../../types/index.js";
import { useFlipBookContext } from "../context.js";
import { useMountedCanvas } from "../hooks/useMountedCanvas.js";

const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

/** The picture inside a thumbnail: a scaled image, a small PDF render, or the page number for React pages. */
export function ThumbnailContent(props: {
  page: FlipBookPage | undefined;
  pageNumber: number;
  /** Thumbnail width in CSS pixels. */
  width: number;
}) {
  const { page, pageNumber, width } = props;
  if (!page) return null;
  if (page.type === "image") {
    return (
      <img
        src={page.thumbnail ?? page.src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{ ...fill, display: "block", objectFit: "contain" }}
      />
    );
  }
  if (page.type === "pdf") return <PdfThumbnail page={page} pageNumber={pageNumber} width={width} />;
  // React pages have no picture to scale down: show where they are.
  return (
    <div
      style={{
        ...fill,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "600 14px system-ui, sans-serif",
        color: "#6b7280",
      }}
    >
      {pageNumber}
    </div>
  );
}

function PdfThumbnail({ page, pageNumber, width }: { page: PdfPage; pageNumber: number; width: number }) {
  const { pdf } = useFlipBookContext();
  useSyncExternalStore(pdf.subscribe, pdf.getVersion, pdf.getVersion);
  const session = pdf.getSession(page.source);
  const ready = session?.getSnapshot().status === "ready";

  // A thumbnail that is cached is shown at once, without a render of its own. Reading the cache
  // does not count as using it.
  const cached = ready && session ? session.peekThumbnail(page.page, width) : null;
  const [fetched, setFetched] = useState<{ session: unknown; docPage: number; width: number; render: RenderedPage } | null>(null);
  const arrived =
    fetched !== null && fetched.session === session && fetched.docPage === page.page && fetched.width === width
      ? fetched.render
      : null;
  const shown = cached ?? arrived;

  useEffect(() => {
    if (!session || !ready) return;
    if (session.peekThumbnail(page.page, width)) return;
    const request = session.requestThumbnail(page.page, { position: pageNumber, cssWidth: width });
    let cancelled = false;
    request.promise.then(
      (render) => {
        if (!cancelled) setFetched({ session, docPage: page.page, width, render });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      // A thumbnail that scrolled away before its turn is never rendered.
      request.cancel();
    };
  }, [session, ready, page.page, pageNumber, width]);

  const holder = useRef<HTMLDivElement>(null);
  useMountedCanvas(holder, shown?.canvas);

  return <div ref={holder} style={fill} />;
}
