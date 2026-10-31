"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { EngineState, FlipBookController } from "../../core/types.js";
import type { UiSnapshot } from "../../core/ui/UiStore.js";
import type { ZoomSnapshot } from "../../core/zoom/ZoomController.js";
import type { FlipBookFeatures, FlipBookLocale } from "../../types/index.js";
import { useFlipBookContext } from "../context.js";
import { useEngineState } from "./useEngineState.js";

export interface UseFlipBookResult extends FlipBookController {
  /** Re-renders the calling component when the page, view or turn state changes. */
  state: EngineState;
  /** Re-renders when the zoom settles on a new value or the book becomes zoomed in or out. */
  zoomState: ZoomSnapshot;
  /** Open panel, current notice, print progress and fullscreen mode. */
  ui: UiSnapshot;
  /** Every bookmarked page, sorted. */
  bookmarks: readonly number[];
  /** Whether a page on screen is bookmarked. */
  currentBookmarked: boolean;
  /** Which optional features are on and usable. */
  features: FlipBookFeatures;
  locale: FlipBookLocale;
  canGoNext: boolean;
  canGoPrevious: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/**
 * Controls and live state for the nearest `<FlipBook>` or `<FlipBookProvider>`.
 * The methods are bound and stable, so they can be passed straight to `onClick`.
 */
export function useFlipBook(): UseFlipBookResult {
  const { engine, zoom, ui, bookmarks, features, locale, controller } = useFlipBookContext();
  const state = useEngineState(engine);
  const zoomState = useSyncExternalStore(zoom.subscribe, zoom.getSnapshot, zoom.getSnapshot);
  const uiState = useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot);
  const saved = useSyncExternalStore(bookmarks.subscribe, bookmarks.getSnapshot, bookmarks.getSnapshot);
  return useMemo(
    () => ({
      ...controller,
      state,
      zoomState,
      ui: uiState,
      bookmarks: saved,
      currentBookmarked: state.visiblePages.some((page) => saved.includes(page)),
      features,
      locale,
      canGoNext: state.spreadIndex < state.spreadCount - 1,
      canGoPrevious: state.spreadIndex > 0,
      canZoomIn: zoomState.canZoomIn,
      canZoomOut: zoomState.canZoomOut,
    }),
    [controller, state, zoomState, uiState, saved, features, locale],
  );
}
