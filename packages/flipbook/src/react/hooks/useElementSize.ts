"use client";

import { useState, type RefObject } from "react";
import { useIsoLayoutEffect } from "./useIsoLayoutEffect.js";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Content-box size of an element, kept current with `ResizeObserver`.
 * `null` until the first measurement, which only happens in the browser.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null);

  useIsoLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = (width: number, height: number): void => {
      const w = Math.floor(width);
      const h = Math.floor(height);
      setSize((previous) =>
        previous && previous.width === w && previous.height === h
          ? previous
          : { width: w, height: h },
      );
    };
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      update(rect.width, rect.height);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
