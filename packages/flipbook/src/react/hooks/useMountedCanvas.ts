"use client";

import type { RefObject } from "react";
import { useIsoLayoutEffect } from "./useIsoLayoutEffect.js";

const CANVAS_STYLE = "display:block;width:100%;height:100%;object-fit:contain;";

/**
 * Puts a rendered canvas into `holder` and returns the function that takes it out again. The
 * canvas belongs to the page cache, not to React: it is a DOM node that moves between the cache
 * and the page, so it is attached by hand.
 */
export function mountCanvas(holder: HTMLElement, canvas: HTMLCanvasElement): () => void {
  canvas.style.cssText = CANVAS_STYLE;
  holder.appendChild(canvas);
  return () => {
    // The same canvas may already have moved to another page view.
    if (canvas.parentNode === holder) holder.removeChild(canvas);
  };
}

/** Shows `canvas` inside the element `holder` points at, for as long as both exist. */
export function useMountedCanvas(
  holder: RefObject<HTMLElement | null>,
  canvas: HTMLCanvasElement | null | undefined,
): void {
  useIsoLayoutEffect(() => {
    const element = holder.current;
    if (!element || !canvas) return;
    return mountCanvas(element, canvas);
  }, [holder, canvas]);
}
