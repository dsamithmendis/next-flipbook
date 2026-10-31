import type { ReactElement } from "react";

export type FlipBookIconName =
  | "chevron-left"
  | "chevron-right"
  | "minus"
  | "plus"
  | "fit"
  | "expand"
  | "shrink"
  | "bookmark"
  | "bookmark-filled"
  | "bookmarks"
  | "grid"
  | "download"
  | "print"
  | "share"
  | "close"
  | "search"
  | "list"
  | "chevron-up"
  | "chevron-down";

const PATHS: Record<FlipBookIconName, string> = {
  "chevron-left": "M15 5l-7 7 7 7",
  "chevron-right": "M9 5l7 7-7 7",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  fit: "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  "bookmark-filled": "M6 3h12v18l-6-4-6 4z",
  bookmarks: "M7 3h11v15M4 7h11v14l-5.5-3.5L4 21z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  print: "M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  share: "M12 16V4M7 9l5-5 5 5M5 14v6h14v-6",
  close: "M6 6l12 12M18 6L6 18",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  "chevron-up": "M5 15l7-7 7 7",
  "chevron-down": "M5 9l7 7 7-7",
};

/** The small set of icons used by the built-in toolbar. Drawn inline: no icon dependency. */
export function FlipBookIcon({
  name,
  size = 20,
}: {
  name: FlipBookIconName;
  size?: number;
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === "bookmark-filled" ? "currentColor" : "none"}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
