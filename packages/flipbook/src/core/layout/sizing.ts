import type { FlipBookDirection, FlipBookMode, FlipBookView } from "../types.js";
import type { Spread } from "./spreads.js";

/** `"auto"` reads the first page, a number is width / height, `"4/3"` is a ratio. */
export type AspectRatioProp = "auto" | number | `${number}/${number}`;

/** Used until the real ratio is known, and for books made only of custom pages. */
export const DEFAULT_PAGE_ASPECT = 3 / 4;

/** Returns width / height, or `null` for `"auto"` and anything unparseable. */
export function parseAspectRatio(value: AspectRatioProp): number | null {
  if (value === "auto") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/** Resolves `auto` from the container width, never from `window`. */
export function resolveView(
  mode: FlipBookMode,
  containerWidth: number,
  breakpoint: number,
): FlipBookView {
  if (mode !== "auto") return mode;
  return containerWidth >= breakpoint ? "double" : "single";
}

export interface BookLayout {
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Width of the whole book box: one page in single view, two in double. */
  readonly bookWidth: number;
}

/** Largest whole-pixel page that fits the container at the given aspect ratio. */
export function fitBook(input: {
  containerWidth: number;
  containerHeight: number;
  pageAspect: number;
  view: FlipBookView;
}): BookLayout {
  const across = input.view === "double" ? 2 : 1;
  const aspect =
    Number.isFinite(input.pageAspect) && input.pageAspect > 0
      ? input.pageAspect
      : DEFAULT_PAGE_ASPECT;
  const width = Math.max(0, input.containerWidth);
  const height = Math.max(0, input.containerHeight);
  const pageWidth = Math.floor(Math.min(width / across, height * aspect));
  const pageHeight = Math.floor(pageWidth / aspect);
  return { pageWidth, pageHeight, bookWidth: pageWidth * across };
}

/**
 * Horizontal shift, in page widths, that centres a lone page (a closed
 * book's cover or back cover) inside the two-page book box.
 */
export function centeringShift(
  spread: Spread,
  view: FlipBookView,
  direction: FlipBookDirection,
): number {
  if (view === "single") return 0;
  const sign = direction === "ltr" ? 1 : -1;
  if (spread.verso === null && spread.recto !== null) return -0.5 * sign;
  if (spread.recto === null && spread.verso !== null) return 0.5 * sign;
  return 0;
}

export type PageSide = "verso" | "recto";

/** Left offset in pixels of a page slot inside the book box. */
export function slotLeft(
  side: PageSide,
  view: FlipBookView,
  direction: FlipBookDirection,
  pageWidth: number,
): number {
  if (view === "double") {
    const rectoLeft = direction === "ltr" ? pageWidth : 0;
    const versoLeft = direction === "ltr" ? 0 : pageWidth;
    return side === "recto" ? rectoLeft : versoLeft;
  }
  if (side === "recto") return 0;
  // In single view a turned page swings out of the box and is clipped.
  return direction === "ltr" ? -pageWidth : pageWidth;
}

/** Which edge of a page is bound to the spine. */
export function spineSide(side: PageSide, direction: FlipBookDirection): "left" | "right" {
  const rectoSpine = direction === "ltr" ? "left" : "right";
  if (side === "recto") return rectoSpine;
  return rectoSpine === "left" ? "right" : "left";
}
