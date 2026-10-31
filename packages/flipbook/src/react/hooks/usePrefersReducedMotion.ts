"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const canMatchMedia = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

function subscribe(onChange: () => void): () => void {
  if (!canMatchMedia()) return () => undefined;
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const getSnapshot = (): boolean => (canMatchMedia() ? window.matchMedia(QUERY).matches : false);

/** Server snapshot is `false`; the browser value is applied right after hydration. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
