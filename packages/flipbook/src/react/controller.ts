import type { FlipBookEngine } from "../core/engine/FlipBookEngine.js";
import type { BookmarkStore } from "../core/bookmarks/BookmarkStore.js";
import type { SearchController } from "../core/search/SearchController.js";
import type { FlipBookCacheStats, FlipBookController, FlipBookOutlineItem } from "../core/types.js";
import type { UiStore } from "../core/ui/UiStore.js";
import type { ZoomController } from "../core/zoom/ZoomController.js";
import type { FullscreenController } from "../actions/fullscreen.js";
import type { FlipBookFeatures, FlipBookLocale } from "../types/index.js";
import { formatMessage } from "./locale.js";

export interface ControllerDeps {
  engine: FlipBookEngine;
  zoom: ZoomController;
  bookmarks: BookmarkStore;
  ui: UiStore;
  fullscreen: FullscreenController;
  /** Read at call time, so the controller stays stable while props change. */
  getFeatures: () => FlipBookFeatures;
  getLocale: () => FlipBookLocale;
  actions: { download: () => Promise<void>; print: () => Promise<void>; share: () => Promise<void> };
  search: SearchController;
  runSearch: (query: string) => Promise<void>;
  getOutline: () => Promise<FlipBookOutlineItem[]>;
  getCacheStats: () => FlipBookCacheStats;
}

/** Bound, stable controller: safe to pass straight to `onClick`. */
export function createController(deps: ControllerDeps): FlipBookController {
  const { engine, zoom, bookmarks, ui, fullscreen, actions } = deps;

  const visible = (): readonly number[] => engine.getState().visiblePages;
  const say = (template: keyof Pick<FlipBookLocale, "bookmarkAdded" | "bookmarkRemoved">, page: number): void =>
    ui.notify(formatMessage(deps.getLocale()[template], { page }));
  const bookmarksOn = (): boolean => deps.getFeatures().bookmarks;

  const add = (page?: number): void => {
    if (!bookmarksOn()) return;
    const target = page ?? engine.getCurrentPage();
    if (bookmarks.add(target)) say("bookmarkAdded", target);
  };
  const remove = (page?: number): void => {
    if (!bookmarksOn()) return;
    const targets = page === undefined ? visible().filter((p) => bookmarks.has(p)) : [page];
    for (const target of targets) if (bookmarks.remove(target)) say("bookmarkRemoved", target);
  };

  return {
    // navigation
    next: () => engine.next(),
    previous: () => engine.previous(),
    goToPage: (page) => engine.goToPage(page),
    first: () => engine.first(),
    last: () => engine.last(),
    getCurrentPage: () => engine.getCurrentPage(),
    getPageCount: () => engine.getPageCount(),
    isAnimating: () => engine.isAnimating(),

    // zoom
    zoomIn: () => zoom.zoomIn(),
    zoomOut: () => zoom.zoomOut(),
    setZoom: (value) => zoom.zoomTo(value),
    fit: () => zoom.fit(),
    fitWidth: () => zoom.fitWidth(),
    fitHeight: () => zoom.fitHeight(),
    getZoom: () => zoom.getZoom(),

    // fullscreen
    enterFullscreen: () => {
      if (deps.getFeatures().fullscreen) void fullscreen.enter();
    },
    exitFullscreen: () => void fullscreen.exit(),
    toggleFullscreen: () => {
      if (deps.getFeatures().fullscreen || fullscreen.isFullscreen()) void fullscreen.toggle();
    },
    isFullscreen: () => fullscreen.isFullscreen(),

    // bookmarks
    addBookmark: add,
    removeBookmark: remove,
    toggleBookmark: (page) => {
      if (!bookmarksOn()) return;
      if (page !== undefined) {
        if (bookmarks.has(page)) remove(page);
        else add(page);
        return;
      }
      if (visible().some((p) => bookmarks.has(p))) remove();
      else add();
    },
    isBookmarked: (page) =>
      page === undefined ? visible().some((p) => bookmarks.has(p)) : bookmarks.has(page),
    getBookmarks: () => bookmarks.list(),
    clearBookmarks: () => {
      if (bookmarksOn()) bookmarks.clear();
    },

    // panel
    openPanel: (panel) => {
      const features = deps.getFeatures();
      if (features[panel === "thumbnails" ? "thumbnails" : panel === "bookmarks" ? "bookmarks" : panel]) {
        ui.setPanel(panel);
      }
    },
    closePanel: () => ui.setPanel(null),
    togglePanel: (panel) => {
      const features = deps.getFeatures();
      if (features[panel]) ui.togglePanel(panel);
    },
    getPanel: () => ui.getSnapshot().panel,

    // search and contents
    search: async (query) => {
      if (!deps.getFeatures().search) return;
      ui.setPanel("search");
      await deps.runSearch(query);
    },
    nextSearchResult: () => deps.search.next(),
    previousSearchResult: () => deps.search.previous(),
    clearSearch: () => deps.search.clear(),
    getSearchResults: () => deps.search.getSnapshot().results,
    getOutline: () => deps.getOutline(),
    getCacheStats: () => deps.getCacheStats(),

    // actions: inert unless the matching prop is on
    download: () => (deps.getFeatures().download ? actions.download() : Promise.resolve()),
    print: () => (deps.getFeatures().print ? actions.print() : Promise.resolve()),
    share: () => (deps.getFeatures().share ? actions.share() : Promise.resolve()),
  };
}
