"use client";

import { createContext, useContext } from "react";
import type { FlipBookEngine } from "../core/engine/FlipBookEngine.js";
import type { FlipBookError } from "../core/errors.js";
import type { FlipBookController, FlipBookDirection, FlipBookMode } from "../core/types.js";
import type { ImageLoader } from "../image/loader.js";
import type { BookmarkStore } from "../core/bookmarks/BookmarkStore.js";
import type { SearchController } from "../core/search/SearchController.js";
import type { UiStore } from "../core/ui/UiStore.js";
import type { ZoomController } from "../core/zoom/ZoomController.js";
import type { FullscreenController } from "../actions/fullscreen.js";
import type { PdfManager } from "../pdf/manager.js";
import type { PasswordReason } from "../pdf/types.js";
import type { BookContent } from "./hooks/useBookContent.js";
import type { FlipBookFeatures, FlipBookLocale, FlipBookPage } from "../types/index.js";

/** State of the PDF given through `source`. `none` when the book is built from `pages`. */
export interface DocumentState {
  status: "none" | "loading" | "password" | "ready" | "error";
  /** 0..1 while downloading, null when unknown. */
  progress: number | null;
  error: FlipBookError | null;
}

/** A pending password prompt for the built-in dialog. */
export interface PasswordPrompt {
  id: string;
  reason: PasswordReason;
  /** A string answers the prompt; `null` cancels it. */
  submit: (password: string | null) => void;
}

export interface FlipBookContextValue {
  engine: FlipBookEngine;
  controller: FlipBookController;
  imageLoader: ImageLoader;
  pdf: PdfManager;
  zoom: ZoomController;
  bookmarks: BookmarkStore;
  ui: UiStore;
  fullscreen: FullscreenController;
  features: FlipBookFeatures;
  search: SearchController;
  /** What comes from the pages themselves: contents, hotspots, overlays and links. */
  content: Pick<
    BookContent,
    "outline" | "positionOf" | "hotspotsByPage" | "overlays" | "linksEnabled" | "allowLink" | "runSearch"
  >;
  /** Toolbar actions. Each shows its own notice on failure and never rejects. */
  actions: {
    download: () => Promise<void>;
    print: () => Promise<void>;
    share: () => Promise<void>;
  };
  /** Pointer and wheel behaviour, from the book props. */
  interaction: {
    zoomEnabled: boolean;
    dragToTurn: boolean;
    wheelZoom: boolean | "ctrl";
    /** `false` turns double-tap zoom off. */
    doubleTapZoom: number | false;
    reducedMotion: boolean;
  };
  document: DocumentState;
  /** Set when the built-in dialog should be shown. `null` when `onPassword` handles it. */
  password: PasswordPrompt | null;
  pages: readonly FlipBookPage[];
  mode: FlipBookMode;
  breakpoint: number;
  direction: FlipBookDirection;
  locale: FlipBookLocale;
  /** Shadow strength 0..1 after applying the `shadow` switch. */
  shadowStrength: number;
  reportError: (error: FlipBookError) => void;
  /** A single page failed. Also forwards to `onPageError`. */
  reportPageError: (error: FlipBookError) => void;
  notifyReady: () => void;
}

export const FlipBookContext = createContext<FlipBookContextValue | null>(null);

export function useFlipBookContext(): FlipBookContextValue {
  const value = useContext(FlipBookContext);
  if (value === null) {
    throw new Error(
      "[next-flipbook] This component or hook must be rendered inside <FlipBook> or <FlipBookProvider>.",
    );
  }
  return value;
}
