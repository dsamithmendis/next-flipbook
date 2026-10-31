"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { toFlipBookError } from "../../core/errors.js";
import { isCancellation } from "../../pdf/errors.js";
import type { RenderedPage } from "../../pdf/renderer.js";
import type { PdfPageLink } from "../../pdf/types.js";
import type { PdfSession } from "../../pdf/session.js";
import type { PdfPage } from "../../types/index.js";
import { useFlipBookContext } from "../context.js";
import { useMountedCanvas } from "../hooks/useMountedCanvas.js";
import { formatMessage } from "../locale.js";

const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

export interface PdfPageViewProps {
  page: PdfPage;
  /** Position in the book, 1-based. */
  pageNumber: number;
  /** On-screen width of the page slot in CSS pixels. Decides the render resolution. */
  pageWidth: number | undefined;
}

/**
 * Shows one PDF page. A cached render appears immediately; otherwise a
 * lower-resolution render of the same page is shown (if there is one) while
 * the right one is drawn. The canvas itself is moved into the page, not
 * copied, so a page costs one canvas however often it is shown.
 */
export function PdfPageView({ page, pageNumber, pageWidth = 0 }: PdfPageViewProps) {
  const { pdf, locale, reportError, reportPageError, content, controller } = useFlipBookContext();
  // Re-render when the document finishes loading or fails.
  useSyncExternalStore(pdf.subscribe, pdf.getVersion, pdf.getVersion);

  const session = pdf.getSession(page.source);
  const snapshot = session?.getSnapshot();
  const ready = snapshot?.status === "ready" && pageWidth > 0;
  const key = ready && session ? session.keyFor(page.page, pageWidth) : null;
  const peeked = ready && session ? session.peek(page.page, pageWidth) : null;

  const [fetched, setFetched] = useState<{ key: string; render: RenderedPage } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const shown: RenderedPage | null = peeked?.exact
    ? peeked.render
    : fetched !== null && fetched.key === key
      ? fetched.render
      : (peeked?.render ?? null);

  useEffect(() => {
    if (!session || !key) return;
    // Drawn already, perhaps between the render and now: nothing to ask for.
    if (session.peek(page.page, pageWidth)?.exact) return;
    let cancelled = false;
    session.request(page.page, { position: pageNumber, cssWidth: pageWidth }).then(
      (render) => {
        if (!cancelled) setFetched({ key, render });
      },
      (reason: unknown) => {
        if (cancelled || isCancellation(reason)) return;
        setFailedKey(key);
        const error = toFlipBookError(reason, {
          code: "PAGE_RENDER_FAILED",
          message: `Failed to render page ${pageNumber}.`,
          page: pageNumber,
        });
        reportError(error);
        reportPageError(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session, key, page.page, pageNumber, pageWidth, reportError, reportPageError]);

  const holder = useRef<HTMLDivElement>(null);
  useMountedCanvas(holder, shown?.canvas);

  const label = page.alt ?? formatMessage(locale.pageAlt, { page: pageNumber });
  const failed =
    snapshot?.status === "error" || (failedKey !== null && failedKey === key && shown === null);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={label}
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
    <div style={{ ...fill, overflow: "hidden" }}>
      <div ref={holder} role="img" aria-label={label} aria-busy={shown === null} style={fill} />
      {content.linksEnabled && session && snapshot?.status === "ready" ? (
        <PdfLinkLayer
          session={session}
          page={page}
          goTo={(position) => controller.goToPage(position)}
        />
      ) : null}
    </div>
  );
}

/**
 * The clickable links of a PDF page. Web links open as real links (so middle
 * click and "copy address" work), internal links turn the book to the page.
 */
function PdfLinkLayer({
  session,
  page,
  goTo,
}: {
  session: PdfSession;
  page: PdfPage;
  goTo: (position: number) => void;
}) {
  const { content, locale } = useFlipBookContext();
  const [links, setLinks] = useState<readonly PdfPageLink[]>([]);

  useEffect(() => {
    let cancelled = false;
    session.getLinks(page.page).then(
      (found) => {
        if (!cancelled) setLinks(found);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [session, page.page]);

  if (links.length === 0) return null;
  return (
    <div data-flipbook-links="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {links.map((link, index) => {
        const box: CSSProperties = {
          position: "absolute",
          left: `${link.rect.x * 100}%`,
          top: `${link.rect.y * 100}%`,
          width: `${link.rect.width * 100}%`,
          height: `${link.rect.height * 100}%`,
          pointerEvents: "auto",
          display: "block",
          borderRadius: 2,
        };
        if (link.kind === "url" && link.url) {
          const url = link.url;
          return (
            <a
              key={index}
              data-flipbook-link=""
              href={url}
              target={link.newWindow ? "_blank" : undefined}
              rel="noopener noreferrer"
              aria-label={formatMessage(locale.linkOpen, { url })}
              onClick={(event) => {
                if (!content.allowLink({ type: "url", url })) event.preventDefault();
              }}
              style={box}
            />
          );
        }
        const target = link.page === null ? null : content.positionOf(page.source, link.page);
        if (target === null) return null;
        return (
          <a
            key={index}
            data-flipbook-link=""
            href={`#page-${target}`}
            aria-label={formatMessage(locale.linkPage, { page: target })}
            onClick={(event) => {
              event.preventDefault();
              if (content.allowLink({ type: "page", page: target })) goTo(target);
            }}
            style={box}
          />
        );
      })}
    </div>
  );
}
