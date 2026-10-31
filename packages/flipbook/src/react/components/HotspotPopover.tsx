"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FlipBookIcon } from "../icons.js";

export interface HotspotPopoverProps {
  label: string;
  closeLabel: string;
  /** Position inside the book, in pixels. */
  left: number;
  top: number;
  /** Open above the point instead of below it. */
  above: boolean;
  maxWidth: number;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A small non-modal dialog next to a hotspot. It takes focus when it opens,
 * closes on Escape (handled by the viewer), a click elsewhere or its button,
 * and gives focus back to the hotspot.
 */
export function HotspotPopover(props: HotspotPopoverProps) {
  const { label, closeLabel, left, top, above, maxWidth, onClose, children } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-flipbook-popover=""
      // A press inside the popover must never start a page turn.
      data-flipbook-no-drag=""
      style={{
        position: "absolute",
        left,
        top,
        transform: `translate(-50%, ${above ? "-100%" : "0"})`,
        zIndex: 7,
        boxSizing: "border-box",
        maxWidth,
        minWidth: 160,
        padding: "12px 34px 12px 14px",
        borderRadius: 10,
        background: "var(--flipbook-toolbar-background, #ffffff)",
        color: "var(--flipbook-toolbar-color, #1f2328)",
        boxShadow: "0 8px 28px rgba(0, 0, 0, 0.28)",
        font: "14px/1.45 system-ui, sans-serif",
        outline: "none",
      }}
    >
      <button
        type="button"
        data-flipbook-button=""
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
        style={{
          position: "absolute",
          top: 4,
          insetInlineEnd: 4,
          width: 28,
          height: 28,
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
        <FlipBookIcon name="close" size={14} />
      </button>
      {children}
    </div>
  );
}
