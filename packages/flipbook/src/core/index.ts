export { FlipBookEngine } from "./engine/FlipBookEngine.js";
export {
  centeringShift,
  DEFAULT_PAGE_ASPECT,
  fitBook,
  parseAspectRatio,
  resolveView,
  slotLeft,
  spineSide,
} from "./layout/sizing.js";
export type { AspectRatioProp, BookLayout, PageSide } from "./layout/sizing.js";
export {
  getSpread,
  pageToSpreadIndex,
  spreadCount,
  spreadFirstPage,
  spreadPages,
} from "./layout/spreads.js";
export type { LayoutOptions, Spread } from "./layout/spreads.js";
export { FLICK_VELOCITY, dragProgress, dragTravel, shouldCompleteTurn } from "./interaction/drag.js";
export { GestureRecognizer } from "./interaction/GestureRecognizer.js";
export type {
  GestureConfig,
  GestureHandlers,
  Point,
  PointerInput,
  PointerKind,
} from "./interaction/GestureRecognizer.js";
export { ZOOMED_ABOVE, ZoomController } from "./zoom/ZoomController.js";
export type {
  ZoomConfig,
  ZoomDeps,
  ZoomSnapshot,
  ZoomTransform,
  ZoomViewport,
} from "./zoom/ZoomController.js";
export { computeTurnVisuals } from "./animation/turn.js";
export type { TurnVisuals, TurnVisualsInput } from "./animation/turn.js";
export { easeInOutCubic, easeOutCubic, springEase } from "./animation/easing.js";
export { createBrowserScheduler } from "./animation/scheduler.js";
export type { Scheduler } from "./animation/scheduler.js";
export { tween } from "./animation/tween.js";
export type { TweenHandle, TweenOptions } from "./animation/tween.js";
export { BookmarkStore } from "./bookmarks/BookmarkStore.js";
export type {
  BookmarkChangeOrigin,
  BookmarkStorage,
  BookmarkStoreOptions,
} from "./bookmarks/BookmarkStore.js";
export { buildPageText, compileQuery, estimateTextBytes, findMatches } from "./search/text.js";
export type { PageText, RawTextItem, RectMapper, TextMatch, TextRect, TextRun } from "./search/text.js";
export { SearchController } from "./search/SearchController.js";
export type {
  Highlight,
  SearchControllerOptions,
  SearchResult,
  SearchSnapshot,
  SearchSource,
  SearchStatus,
} from "./search/SearchController.js";
export { readReadingState, writeReadingState } from "./persistence/readingState.js";
export type { ReadingState, StorageLike } from "./persistence/readingState.js";
export { UiStore } from "./ui/UiStore.js";
export type { FullscreenMode, PanelId, UiDeps, UiNotice, UiSnapshot } from "./ui/UiStore.js";
export { PageCache } from "./cache/PageCache.js";
export type { PageCacheHooks, PageCacheLimits, PageCacheStats } from "./cache/PageCache.js";
export { FlipBookRuntimeError, toFlipBookError } from "./errors.js";
export type { FlipBookError, FlipBookErrorCode } from "./errors.js";
export type {
  EngineConfig,
  EngineConfigPatch,
  EngineEventMap,
  EngineOptions,
  EngineState,
  FlipBookController,
  FlipBookDirection,
  FlipBookActionControls,
  FlipBookBookmarkControls,
  FlipBookCacheControls,
  FlipBookCacheStats,
  FlipBookFullscreenControls,
  FlipBookNavigation,
  FlipBookOutlineControls,
  FlipBookOutlineItem,
  FlipBookPanelControls,
  FlipBookSearchControls,
  FlipBookZoomControls,
  FlipBookMode,
  FlipBookView,
  TurnState,
  WhileTurning,
} from "./types.js";
