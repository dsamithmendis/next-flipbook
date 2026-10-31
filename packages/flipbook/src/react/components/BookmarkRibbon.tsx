import type { CSSProperties, ReactElement } from "react";

/** A small ribbon hanging from the top edge of a bookmarked page. */
export function BookmarkRibbon({
  side,
  size = 1,
}: {
  /** Which top corner: the one away from the spine looks natural. */
  side: "left" | "right";
  size?: number;
}): ReactElement {
  const style: CSSProperties = {
    position: "absolute",
    top: 0,
    [side]: `${Math.round(10 * size)}px`,
    pointerEvents: "none",
    filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3))",
  };
  return (
    <svg
      data-flipbook-ribbon=""
      aria-hidden="true"
      focusable="false"
      width={Math.round(16 * size)}
      height={Math.round(26 * size)}
      viewBox="0 0 16 26"
      style={style}
    >
      <path d="M0 0h16v26l-8-6-8 6z" fill="var(--flipbook-accent, #2563eb)" />
    </svg>
  );
}
