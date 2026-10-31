"use client";

import { useId, type CSSProperties, type KeyboardEvent } from "react";
import type { AspectRatioProp } from "../../core/layout/sizing.js";
import type { PanelId } from "../../core/ui/UiStore.js";
import { useFlipBook } from "../hooks/useFlipBook.js";
import { FlipBookIcon } from "../icons.js";
import { FlipBookBookmarks } from "./FlipBookBookmarks.js";
import { FlipBookSearch } from "./FlipBookSearch.js";
import { FlipBookTOC } from "./FlipBookTOC.js";
import { FlipBookThumbnails } from "./FlipBookThumbnails.js";

export interface FlipBookSidePanelProps {
  /** `sidebar` sits beside the book; `sheet` slides over the bottom of it on narrow screens. */
  variant?: "sidebar" | "sheet";
  aspectRatio?: AspectRatioProp;
}

const container = (variant: "sidebar" | "sheet", wide: boolean): CSSProperties =>
  variant === "sidebar"
    ? {
        flex: "none",
        width: wide ? 272 : 176,
        minHeight: 0,
        borderInlineEnd: "1px solid rgba(127, 127, 127, 0.3)",
      }
    : {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "46%",
        zIndex: 5,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        boxShadow: "0 -6px 24px rgba(0, 0, 0, 0.2)",
      };

/**
 * The panel the toolbar opens: thumbnails and, when bookmarks are on, the
 * bookmark list, with tabs to switch. Escape closes it.
 */
export function FlipBookSidePanel({ variant = "sidebar", aspectRatio = "auto" }: FlipBookSidePanelProps) {
  const book = useFlipBook();
  const { ui, features, locale } = book;
  const id = useId();
  const panel = ui.panel;
  if (panel === null) return null;

  const tabs: PanelId[] = [];
  if (features.thumbnails) tabs.push("thumbnails");
  if (features.bookmarks) tabs.push("bookmarks");
  if (features.search) tabs.push("search");
  if (features.outline) tabs.push("outline");
  const labels: Record<PanelId, string> = {
    thumbnails: locale.pagesTab,
    bookmarks: locale.bookmarks,
    search: locale.search,
    outline: locale.outline,
  };
  const label = (tab: PanelId): string => labels[tab];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      book.closePanel();
      return;
    }
    // Arrow keys switch tabs while a tab has focus.
    if (
      tabs.length > 1 &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      (event.target as HTMLElement).getAttribute("role") === "tab"
    ) {
      event.preventDefault();
      event.stopPropagation();
      const at = tabs.indexOf(panel);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(at + step + tabs.length) % tabs.length] ?? panel;
      book.openPanel(next);
      (document.getElementById(`${id}-tab-${next}`))?.focus();
    }
  };

  const select = (): void => {
    if (variant === "sheet") book.closePanel();
  };

  return (
    <div
      data-flipbook-panel={variant}
      onKeyDown={onKeyDown}
      style={{
        ...container(variant, panel === "search" || panel === "outline"),
        display: "flex",
        flexDirection: "column",
        background: "var(--flipbook-toolbar-background, rgba(255, 255, 255, 0.97))",
        color: "var(--flipbook-toolbar-color, #1f2328)",
      }}
    >
      <div style={{ flex: "none", display: "flex", alignItems: "center", padding: "4px 4px 0 8px", gap: 4 }}>
        <div role="tablist" style={{ flex: 1, display: "flex", gap: 2 }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              id={`${id}-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={panel === tab}
              aria-controls={`${id}-body`}
              tabIndex={panel === tab ? 0 : -1}
              onClick={() => book.openPanel(tab)}
              style={{
                padding: "8px 8px",
                border: 0,
                borderBottom: `2px solid ${panel === tab ? "var(--flipbook-accent, #2563eb)" : "transparent"}`,
                background: "transparent",
                color: "inherit",
                font: `${panel === tab ? 600 : 400} 13px/1 system-ui, sans-serif`,
                cursor: "pointer",
              }}
            >
              {label(tab)}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-flipbook-button=""
          aria-label={locale.closePanel}
          title={locale.closePanel}
          onClick={book.closePanel}
          style={{
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
      </div>
      <div id={`${id}-body`} role="tabpanel" aria-labelledby={`${id}-tab-${panel}`} style={{ flex: 1, minHeight: 0 }}>
        {panel === "thumbnails" ? (
          <FlipBookThumbnails aspectRatio={aspectRatio} onSelect={select} style={{ height: "100%" }} />
        ) : panel === "bookmarks" ? (
          <FlipBookBookmarks aspectRatio={aspectRatio} onSelect={select} style={{ height: "100%" }} />
        ) : panel === "search" ? (
          <FlipBookSearch style={{ height: "100%" }} />
        ) : (
          <FlipBookTOC onSelect={select} style={{ height: "100%" }} />
        )}
      </div>
    </div>
  );
}
