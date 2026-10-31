"use client";

import type { CSSProperties } from "react";
import type { AspectRatioProp } from "../../core/layout/sizing.js";
import { DEFAULT_PAGE_ASPECT } from "../../core/layout/sizing.js";
import { useFlipBookContext } from "../context.js";
import { useFlipBook } from "../hooks/useFlipBook.js";
import { usePageAspect } from "../hooks/usePageAspect.js";
import { formatMessage } from "../locale.js";
import { FlipBookIcon } from "../icons.js";
import { ThumbnailContent } from "./Thumbnail.js";

export interface FlipBookBookmarksProps {
  aspectRatio?: AspectRatioProp;
  /** Width of one thumbnail in CSS pixels. Default 56. */
  thumbnailWidth?: number;
  onSelect?: (page: number) => void;
  className?: string;
  style?: CSSProperties;
}

/** The list of bookmarked pages, each with a thumbnail, a way to jump to it and a way to remove it. */
export function FlipBookBookmarks(props: FlipBookBookmarksProps) {
  const { aspectRatio = "auto", thumbnailWidth = 56, onSelect, className, style } = props;
  const { pages, imageLoader, pdf, locale, controller } = useFlipBookContext();
  const book = useFlipBook();
  const { aspect } = usePageAspect(pages, aspectRatio, imageLoader, pdf);
  const height = Math.round(thumbnailWidth / (aspect ?? DEFAULT_PAGE_ASPECT));

  return (
    <nav aria-label={locale.bookmarks} className={className} style={{ minHeight: 0, ...style }}>
      {book.bookmarks.length === 0 ? (
        <p style={{ margin: 0, padding: 16, font: "13px/1.5 system-ui, sans-serif", opacity: 0.75 }}>
          {locale.bookmarksEmpty}
        </p>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 8,
            listStyle: "none",
            height: "100%",
            overflowY: "auto",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {book.bookmarks.map((page) => (
            <li key={page} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                data-flipbook-bookmark={page}
                aria-label={formatMessage(locale.thumbnailLabel, { page })}
                onClick={() => {
                  controller.goToPage(page);
                  onSelect?.(page);
                }}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 4,
                  border: 0,
                  borderRadius: 6,
                  background: "transparent",
                  color: "inherit",
                  font: "13px/1.2 system-ui, sans-serif",
                  textAlign: "start",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    position: "relative",
                    flex: "none",
                    width: thumbnailWidth,
                    height,
                    overflow: "hidden",
                    background: "var(--flipbook-page-background, #ffffff)",
                    boxShadow: "0 0 0 1px rgba(127, 127, 127, 0.4)",
                  }}
                >
                  <ThumbnailContent page={pages[page - 1]} pageNumber={page} width={thumbnailWidth} />
                </span>
                <span>{formatMessage(locale.pageAlt, { page })}</span>
              </button>
              <button
                type="button"
                data-flipbook-button=""
                aria-label={formatMessage(locale.removeBookmarkPage, { page })}
                title={formatMessage(locale.removeBookmarkPage, { page })}
                onClick={() => controller.removeBookmark(page)}
                style={{
                  flex: "none",
                  width: 32,
                  height: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: 0,
                  borderRadius: 6,
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <FlipBookIcon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
