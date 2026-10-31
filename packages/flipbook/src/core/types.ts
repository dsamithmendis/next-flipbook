import type { Scheduler } from "./animation/scheduler.js";
import type { PageCacheStats } from "./cache/PageCache.js";
import type { SearchResult } from "./search/SearchController.js";
import type { PanelId } from "./ui/UiStore.js";
import type { Spread } from "./layout/spreads.js";

/** How many pages are visible at once. */
export type FlipBookView = "single" | "double";
/** `auto` picks `single` or `double` from the container width. */
export type FlipBookMode = FlipBookView | "auto";
export type FlipBookDirection = "ltr" | "rtl";
/** What to do with navigation commands that arrive while a page is turning. */
export type WhileTurning = "ignore" | "queue";

/** A page turn in progress. Spread indices, not page numbers. */
export interface TurnState {
  readonly from: number;
  readonly to: number;
  readonly forward: boolean;
}

/** Immutable snapshot of the engine. A new object is produced on every change. */
export interface EngineState {
  readonly pageCount: number;
  readonly view: FlipBookView;
  readonly cover: boolean;
  readonly direction: FlipBookDirection;
  readonly spreadIndex: number;
  readonly spreadCount: number;
  readonly spread: Spread;
  /** First visible page of the spread the reader is on (or turning to). 0 when empty. */
  readonly currentPage: number;
  readonly visiblePages: readonly number[];
  /**
   * `turning` is a scripted page turn, `dragging` is a page held by the
   * reader, and `settling` is a released page finishing its turn or springing back.
   */
  readonly status: "idle" | "turning" | "dragging" | "settling";
  readonly turn: TurnState | null;
}

export interface EngineConfig {
  pageCount: number;
  view: FlipBookView;
  cover: boolean;
  direction: FlipBookDirection;
  /** Base page-turn duration in milliseconds. */
  duration: number;
  /** When true, page changes are instant. */
  reducedMotion: boolean;
  whileTurning: WhileTurning;
}

export type EngineConfigPatch = Partial<EngineConfig>;

export interface EngineOptions extends Partial<EngineConfig> {
  pageCount: number;
  /** 1-based. Defaults to 1. */
  initialPage?: number;
  /** Injectable for tests. Defaults to `requestAnimationFrame`. */
  scheduler?: Scheduler;
}

export interface EngineEventMap {
  pagechange: { page: number };
  turnstart: { fromPage: number; toPage: number };
  turnend: { page: number };
}

/** Page navigation, implemented by the engine. */
export interface FlipBookNavigation {
  next: () => void;
  previous: () => void;
  /** 1-based. */
  goToPage: (page: number) => void;
  first: () => void;
  last: () => void;
  getCurrentPage: () => number;
  getPageCount: () => number;
  isAnimating: () => boolean;
}

/** Zoom and pan. All of it is inert when the `zoom` prop is false. */
export interface FlipBookZoomControls {
  zoomIn: () => void;
  zoomOut: () => void;
  /** 1 is "fit". Clamped to `minZoom`..`maxZoom`. */
  setZoom: (zoom: number) => void;
  /** Back to the fitted size, centred. */
  fit: () => void;
  /** Zoom so the book fills the container width. */
  fitWidth: () => void;
  /** Zoom so the book fills the container height. */
  fitHeight: () => void;
  getZoom: () => number;
}

/** Fullscreen. Uses the browser API where it can, otherwise fills the window. */
export interface FlipBookFullscreenControls {
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  toggleFullscreen: () => void;
  isFullscreen: () => boolean;
}

/**
 * The reader's bookmarked pages (1-based). Without a page argument, the
 * methods act on the page or spread currently on screen. All inert unless the
 * `bookmarks` prop is on.
 */
export interface FlipBookBookmarkControls {
  addBookmark: (page?: number) => void;
  removeBookmark: (page?: number) => void;
  /** On a spread, removes the bookmarks on it if there are any, otherwise bookmarks the first page. */
  toggleBookmark: (page?: number) => void;
  isBookmarked: (page?: number) => boolean;
  getBookmarks: () => number[];
  clearBookmarks: () => void;
}

/** The side panel (a sidebar, or a bottom sheet on narrow screens). */
export interface FlipBookPanelControls {
  openPanel: (panel: PanelId) => void;
  closePanel: () => void;
  togglePanel: (panel: PanelId) => void;
  getPanel: () => PanelId | null;
}

/** Toolbar actions, for use from your own UI. Each resolves when it is done and never rejects. */
export interface FlipBookActionControls {
  download: () => Promise<void>;
  print: () => Promise<void>;
  share: () => Promise<void>;
}

/** One entry of the table of contents, with `page` as a page number of the book. */
export interface FlipBookOutlineItem {
  title: string;
  /** 1-based page of the book, or null when the entry points elsewhere. */
  page: number | null;
  /** A web address, already checked as safe, when the entry links out instead of to a page. */
  url: string | null;
  bold: boolean;
  italic: boolean;
  items: FlipBookOutlineItem[];
}

/** Text search across the PDF pages of the book. Inert unless the `search` prop is on. */
export interface FlipBookSearchControls {
  /** Opens the search panel, runs the search and selects the first result at or after the current page. */
  search: (query: string) => Promise<void>;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  clearSearch: () => void;
  getSearchResults: () => readonly SearchResult[];
}

/** The PDF's own table of contents (its bookmarks). */
export interface FlipBookOutlineControls {
  /** Resolves to an empty list when there is no PDF, no contents, or the PDF is still loading. */
  getOutline: () => Promise<FlipBookOutlineItem[]>;
}

/** What the viewer is holding in memory. */
export interface FlipBookCacheStats {
  /** Rendered pages. `bytes` is canvas memory; `hits` and `misses` count lookups by the viewer. */
  pages: PageCacheStats;
  /** The small renders in the thumbnail list. */
  thumbnails: PageCacheStats;
  /** The search index: the text of pages already read. */
  text: { pages: number; bytes: number };
}

/** Memory use, for diagnostics and for tuning `cacheSize` and `preloadPages`. */
export interface FlipBookCacheControls {
  /** A snapshot of the page cache, the thumbnail cache and the search index. All zero without a PDF. */
  getCacheStats: () => FlipBookCacheStats;
}

/** Imperative API, available from `ref`, `useFlipBook()` and `renderToolbar`. */
export type FlipBookController = FlipBookNavigation &
  FlipBookZoomControls &
  FlipBookFullscreenControls &
  FlipBookBookmarkControls &
  FlipBookPanelControls &
  FlipBookActionControls &
  FlipBookSearchControls &
  FlipBookOutlineControls &
  FlipBookCacheControls;
