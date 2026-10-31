"use client";

import { useCallback, useRef, type RefObject } from "react";
import { useIsoLayoutEffect } from "./useIsoLayoutEffect.js";

/**
 * The newest value of something, for code that runs later: an effect or an event handler that
 * must not subscribe again just because the parent passed a new inline function or object.
 *
 * The ref is brought up to date after each commit, so read `.current` inside callbacks and
 * effects, never while rendering (a render can be thrown away, and then the ref would hold a
 * value that was never shown).
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * `useLatest`, handed out as a function. For long-lived objects (a controller, a store) that are
 * given a way to ask for the newest value later: a function that is created once and always
 * answers with what the last commit rendered.
 */
export function useLatestGetter<T>(value: T): () => T {
  const ref = useLatest(value);
  return useCallback(() => ref.current, [ref]);
}
