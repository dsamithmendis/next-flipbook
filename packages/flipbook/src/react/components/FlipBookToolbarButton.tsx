"use client";

import type { ReactNode } from "react";
import { FlipBookIcon, type FlipBookIconName } from "../icons.js";

export interface FlipBookToolbarButtonProps {
  /** Accessible name. Also shown as the tooltip. */
  label: string;
  icon: FlipBookIconName;
  onClick?: () => void;
  disabled?: boolean;
  /** For toggles (bookmark, thumbnails, fullscreen): is it on? */
  pressed?: boolean;
  /** Work is in progress. Announced to screen readers. */
  busy?: boolean;
  /** Text shown next to the icon. */
  children?: ReactNode;
}

/** The button the built-in toolbar is made of, exported so a custom toolbar can match it. */
export function FlipBookToolbarButton(props: FlipBookToolbarButtonProps) {
  const { label, icon, onClick, disabled = false, pressed, busy, children } = props;
  return (
    <button
      type="button"
      data-flipbook-button=""
      aria-label={label}
      title={label}
      // aria-disabled keeps the button focusable, so focus is not lost when it greys out.
      aria-disabled={disabled}
      aria-pressed={pressed}
      aria-busy={busy}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        minWidth: 36,
        height: 36,
        padding: children ? "0 8px" : 0,
        border: 0,
        borderRadius: 8,
        background: pressed ? "rgba(127, 127, 127, 0.22)" : "transparent",
        color: "inherit",
        font: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <FlipBookIcon name={icon} />
      {children}
    </button>
  );
}
