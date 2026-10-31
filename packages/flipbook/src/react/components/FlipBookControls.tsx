"use client";

import type { CSSProperties } from "react";
import { useFlipBookContext } from "../context.js";
import { useFlipBook } from "../hooks/useFlipBook.js";
import { formatMessage, formatPageRange } from "../locale.js";
import { FlipBookToolbarButton } from "./FlipBookToolbarButton.js";

/** Previous button, page counter and next button. Used by the toolbar and by `FlipBookControls`. */
export function NavGroup() {
  const { locale } = useFlipBookContext();
  const book = useFlipBook();
  const rtl = book.state.direction === "rtl";

  const indicator = formatMessage(locale.pageIndicator, {
    page: formatPageRange(book.state.visiblePages),
    total: book.state.pageCount,
  });

  return (
    <div
      role="group"
      aria-label={locale.navigationLabel}
      // `dir` rather than row-reverse: it behaves the same whether or not an ancestor is already rtl.
      dir={rtl ? "rtl" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <FlipBookToolbarButton
        label={locale.previous}
        icon={rtl ? "chevron-right" : "chevron-left"}
        disabled={!book.canGoPrevious}
        onClick={book.previous}
      />
      <span style={{ minWidth: "6ch", textAlign: "center" }}>{indicator}</span>
      <FlipBookToolbarButton
        label={locale.next}
        icon={rtl ? "chevron-left" : "chevron-right"}
        disabled={!book.canGoNext}
        onClick={book.next}
      />
    </div>
  );
}

export const BAR_STYLE: CSSProperties = {
  flex: "none",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: "4px 14px",
  padding: "6px 12px",
  paddingBottom: "max(6px, env(safe-area-inset-bottom))",
  background: "var(--flipbook-toolbar-background, rgba(255, 255, 255, 0.92))",
  color: "var(--flipbook-toolbar-color, #1f2328)",
  font: "14px/1 system-ui, sans-serif",
  fontVariantNumeric: "tabular-nums",
};

export interface FlipBookControlsProps {
  className?: string;
  style?: CSSProperties;
}

/** Just previous, next and the page counter, as a bar. For the full toolbar see `FlipBookToolbar`. */
export function FlipBookControls({ className, style }: FlipBookControlsProps) {
  return (
    <div className={className} data-flipbook-controls="" style={{ ...BAR_STYLE, ...style }}>
      <NavGroup />
    </div>
  );
}
