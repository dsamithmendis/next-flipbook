"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFlipBook } from "../hooks/useFlipBook.js";
import { formatMessage } from "../locale.js";
import { BAR_STYLE, NavGroup } from "./FlipBookControls.js";
import { FlipBookToolbarButton } from "./FlipBookToolbarButton.js";

export interface FlipBookToolbarProps {
  /** Show previous, next and the page counter. Default true. */
  navigation?: boolean;
  /** Replaces the built-in buttons. Build with `FlipBookToolbarButton` and `useFlipBook()`. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The toolbar: navigation, zoom, and whichever of bookmarks, thumbnails,
 * fullscreen, download, print and share are switched on. Pass `children` to
 * lay out your own buttons inside the same bar.
 */
export function FlipBookToolbar({ navigation = true, children, className, style }: FlipBookToolbarProps) {
  const book = useFlipBook();
  const { features, locale, ui, zoomState, state } = book;
  const percent = Math.round(zoomState.zoom * 100);
  const fitLabel = formatMessage(locale.fit, { percent });
  const fullscreen = ui.fullscreen !== "none";

  let content: ReactNode = children;
  if (content === undefined) {
    const hasActions =
      features.search ||
      features.outline ||
      features.bookmarks ||
      features.thumbnails ||
      features.fullscreen ||
      features.download ||
      features.print ||
      features.share;
    if (!navigation && !features.zoom && !hasActions) return null;

    content = (
      <>
        {navigation ? <NavGroup /> : null}

        {features.zoom ? (
          <div role="group" aria-label={locale.zoomLabel} style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <FlipBookToolbarButton
              label={locale.zoomOut}
              icon="minus"
              disabled={!book.canZoomOut}
              onClick={book.zoomOut}
            />
            <button
              type="button"
              data-flipbook-button=""
              aria-label={fitLabel}
              title={fitLabel}
              onClick={book.fit}
              style={{
                minWidth: "5ch",
                height: 36,
                padding: "0 6px",
                border: 0,
                borderRadius: 8,
                background: "transparent",
                color: "inherit",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              {percent}%
            </button>
            <FlipBookToolbarButton
              label={locale.zoomIn}
              icon="plus"
              disabled={!book.canZoomIn}
              onClick={book.zoomIn}
            />
          </div>
        ) : null}

        {hasActions ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {features.bookmarks ? (
              <>
                <FlipBookToolbarButton
                  label={book.currentBookmarked ? locale.removeBookmark : locale.addBookmark}
                  icon={book.currentBookmarked ? "bookmark-filled" : "bookmark"}
                  pressed={book.currentBookmarked}
                  onClick={() => book.toggleBookmark()}
                />
                <FlipBookToolbarButton
                  label={locale.bookmarks}
                  icon="bookmarks"
                  pressed={ui.panel === "bookmarks"}
                  onClick={() => book.togglePanel("bookmarks")}
                />
              </>
            ) : null}
            {features.search ? (
              <FlipBookToolbarButton
                label={locale.search}
                icon="search"
                pressed={ui.panel === "search"}
                onClick={() => book.togglePanel("search")}
              />
            ) : null}
            {features.outline ? (
              <FlipBookToolbarButton
                label={locale.outline}
                icon="list"
                pressed={ui.panel === "outline"}
                onClick={() => book.togglePanel("outline")}
              />
            ) : null}
            {features.thumbnails ? (
              <FlipBookToolbarButton
                label={locale.thumbnails}
                icon="grid"
                pressed={ui.panel === "thumbnails"}
                onClick={() => book.togglePanel("thumbnails")}
              />
            ) : null}
            {features.fullscreen ? (
              <FlipBookToolbarButton
                label={fullscreen ? locale.exitFullscreen : locale.fullscreen}
                icon={fullscreen ? "shrink" : "expand"}
                pressed={fullscreen}
                onClick={book.toggleFullscreen}
              />
            ) : null}
            {features.download ? (
              <FlipBookToolbarButton label={locale.download} icon="download" onClick={() => void book.download()} />
            ) : null}
            {features.print ? (
              <FlipBookToolbarButton
                label={locale.print}
                icon="print"
                busy={ui.printing !== null}
                disabled={ui.printing !== null}
                onClick={() => void book.print()}
              />
            ) : null}
            {features.share ? (
              <FlipBookToolbarButton label={locale.share} icon="share" onClick={() => void book.share()} />
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div
      role="group"
      aria-label={locale.toolbarLabel}
      className={className}
      data-flipbook-toolbar=""
      // Right-to-left books mirror the bar, so "previous" stays on the side it came from.
      dir={state.direction === "rtl" ? "rtl" : undefined}
      style={{ ...BAR_STYLE, ...style }}
    >
      {content}
    </div>
  );
}
