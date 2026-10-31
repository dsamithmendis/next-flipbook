"use client";

import { useContext, useState, type CSSProperties, type ReactNode } from "react";
import { FlipBookContext } from "../context.js";
import { DEFAULT_LOCALE, formatMessage } from "../locale.js";
import type { CustomPage, FlipBookPage, ImagePage } from "../../types/index.js";
import { PdfPageView } from "./PdfPageView.js";

const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

export interface FlipBookPageViewProps {
  page: FlipBookPage | null | undefined;
  /** 1-based, used for labels and error reports. */
  pageNumber: number;
  /** On-screen width of the page in CSS pixels. PDF pages use it to pick a render resolution. */
  pageWidth?: number;
}

/** Renders the content of one page: an image, a PDF page, or your own React. */
export function FlipBookPageView({ page, pageNumber, pageWidth }: FlipBookPageViewProps) {
  if (!page) return null;
  if (page.type === "custom") return <CustomPageView page={page} />;
  if (page.type === "pdf") {
    return <PdfPageView page={page} pageNumber={pageNumber} pageWidth={pageWidth} />;
  }
  return <ImagePageView key={page.src} page={page} pageNumber={pageNumber} />;
}

// Rendering `render` inside its own component lets it use hooks safely.
function RenderProp({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

function CustomPageView({ page }: { page: CustomPage }) {
  return (
    <div style={{ ...fill, overflow: "hidden", color: "var(--flipbook-page-color, #1f2328)" }}>
      {page.component ?? (page.render ? <RenderProp render={page.render} /> : null)}
    </div>
  );
}

function ImagePageView({ page, pageNumber }: { page: ImagePage; pageNumber: number }) {
  const context = useContext(FlipBookContext);
  const [failed, setFailed] = useState(false);
  const locale = context?.locale ?? DEFAULT_LOCALE;
  const alt = page.alt ?? formatMessage(locale.pageAlt, { page: pageNumber });

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={{
          ...fill,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          boxSizing: "border-box",
          textAlign: "center",
          font: "14px/1.4 system-ui, sans-serif",
          color: "#6b7280",
        }}
      >
        {locale.pageFailed}
      </div>
    );
  }

  return (
    <img
      src={page.src}
      alt={alt}
      draggable={false}
      decoding="async"
      onError={() => {
        setFailed(true);
        const error = {
          code: "IMAGE_LOAD_FAILED" as const,
          message: `Failed to load page ${pageNumber}: ${page.src}`,
          page: pageNumber,
        };
        context?.reportError(error);
        context?.reportPageError(error);
      }}
      style={{ ...fill, display: "block", objectFit: "contain", userSelect: "none" }}
    />
  );
}
