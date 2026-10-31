import type { CSSProperties, ReactNode } from "react";
import type { AspectRatioProp } from "../core/layout/sizing.js";
import type { FlipBookError } from "../core/errors.js";
import type { FlipBookDirection, FlipBookMode, WhileTurning } from "../core/types.js";
import type { UseFlipBookResult } from "../react/hooks/useFlipBook.js";
import type { BookmarkStorage } from "../core/bookmarks/BookmarkStore.js";
import type { StorageLike } from "../core/persistence/readingState.js";
import type { PasswordReason, PdfOptions, PdfSource } from "../pdf/types.js";

export type {
  EngineState,
  FlipBookActionControls,
  FlipBookOutlineControls,
  FlipBookOutlineItem,
  FlipBookSearchControls,
  FlipBookBookmarkControls,
  FlipBookController,
  FlipBookDirection,
  FlipBookFullscreenControls,
  FlipBookMode,
  FlipBookNavigation,
  FlipBookPanelControls,
  FlipBookView,
  FlipBookZoomControls,
  WhileTurning,
} from "../core/types.js";
export type { BookmarkStorage } from "../core/bookmarks/BookmarkStore.js";
export type { PanelId, UiSnapshot } from "../core/ui/UiStore.js";
export type { SearchResult, SearchSnapshot } from "../core/search/SearchController.js";
export type { StorageLike } from "../core/persistence/readingState.js";
export type { ZoomSnapshot } from "../core/zoom/ZoomController.js";
export type { FlipBookError, FlipBookErrorCode } from "../core/errors.js";
export type { AspectRatioProp } from "../core/layout/sizing.js";
export type { PasswordReason, PdfOptions, PdfSource } from "../pdf/types.js";

export type FlipBookTheme = "light" | "dark";

/** A raster or SVG page. Pass `width` and `height` to skip measuring the image. */
export interface ImagePage {
  type: "image";
  src: string;
  /** A smaller image for the thumbnail list. Without it the full image is scaled down. */
  thumbnail?: string;
  alt?: string;
  width?: number;
  height?: number;
}

/** A page made of React. Prefer `component`; use `render` when you want a function. */
export interface CustomPage {
  type: "custom";
  component?: ReactNode;
  render?: () => ReactNode;
}

/** One page of a PDF. Mix these with images and custom pages in a single book. */
export interface PdfPage {
  type: "pdf";
  source: PdfSource;
  /** 1-based page within that PDF. */
  page: number;
  alt?: string;
}

export type FlipBookPage = ImagePage | CustomPage | PdfPage;

/** A bare string is shorthand for an image page. */
export type FlipBookPageInput = string | FlipBookPage;

/**
 * Every user-visible string. `{page}` and `{total}` are replaced at runtime.
 * Pass a partial object to translate.
 */
export interface FlipBookLocale {
  viewerLabel: string;
  navigationLabel: string;
  next: string;
  previous: string;
  /** Shown in the controls, e.g. "2–3 / 10". */
  pageIndicator: string;
  /** Screen-reader announcement for one visible page. */
  pageStatus: string;
  /** Screen-reader announcement for two visible pages. */
  pagesStatus: string;
  pageAlt: string;
  pageFailed: string;
  loading: string;
  /** `{percent}` is 0..100. */
  loadingProgress: string;
  empty: string;
  passwordTitle: string;
  passwordMessage: string;
  passwordIncorrect: string;
  passwordLabel: string;
  passwordSubmit: string;
  passwordCancel: string;
  toolbarLabel: string;
  zoomOut: string;
  /** Names the group of zoom buttons. */
  zoomLabel: string;
  zoomIn: string;
  /**
   * Name of the zoom percentage button, which returns to the fitted size. `{percent}` is the number
   * the button shows, 125 for "125%". Keep `{percent}%` in the text: the name of a control has to
   * contain the words on it, so that someone who speaks to their device can say what they see.
   */
  fit: string;
  fullscreen: string;
  exitFullscreen: string;
  thumbnails: string;
  bookmarks: string;
  pagesTab: string;
  closePanel: string;
  /** Label of one thumbnail. */
  thumbnailLabel: string;
  thumbnailLabelBookmarked: string;
  addBookmark: string;
  removeBookmark: string;
  /** Button that removes one entry from the bookmark list. */
  removeBookmarkPage: string;
  bookmarkAdded: string;
  bookmarkRemoved: string;
  bookmarksEmpty: string;
  download: string;
  downloadFailed: string;
  print: string;
  /** `{done}` and `{total}` count pages prepared for printing. */
  printPreparing: string;
  printFailed: string;
  printNothing: string;
  share: string;
  shareCopied: string;
  shareFailed: string;
  search: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchPrevious: string;
  searchNext: string;
  /** `{current}` of `{total}` results. */
  searchCount: string;
  searchNone: string;
  /** `{done}` of `{total}` pages read so far. */
  searchSearching: string;
  /** `{count}` results were found before the limit stopped the search. */
  searchTruncated: string;
  outline: string;
  outlineEmpty: string;
  /** `{title}` is the section name. */
  expandSection: string;
  collapseSection: string;
  hotspot: string;
  closeHotspot: string;
  /** `{url}` is the address. */
  linkOpen: string;
  linkPage: string;
}

export interface BookmarkOptions {
  /** Controlled list of bookmarked pages. Changes you make elsewhere flow in here. */
  value?: readonly number[];
  defaultValue?: readonly number[];
  /** Called when the reader adds or removes a bookmark (not when `value` changes). */
  onChange?: (pages: readonly number[]) => void;
  /**
   * Remember bookmarks between visits. `true` keys them by the PDF URL in
   * `source`; use a string to key them yourself (required for `pages` books
   * and for `source` values that are not URLs). The key is prefixed, so it
   * cannot collide with your own storage.
   */
  persist?: boolean | string;
  /** Where to save. Default `window.localStorage`. */
  storage?: BookmarkStorage;
}

export interface DownloadOptions {
  /** Name of the saved file. Default: the PDF's own name, or `document.pdf`. */
  filename?: string;
  /** What to download when the book has no PDF `source` (an image book, say). */
  url?: string | URL;
}

export interface PrintOptions {
  /** Pixels per PDF point for PDF pages. Default 2 (about 144 dpi). */
  scale?: number;
}

export interface ShareOptions {
  /** Default: the current page address. */
  url?: string;
  /** Default: the document title. */
  title?: string;
  text?: string;
}

export interface SearchOptions {
  /** Shortest query that searches. Default 2. */
  minLength?: number;
  /** Stop after this many results. Default 500. */
  maxResults?: number;
}

/** A region of a page that the reader can activate. Coordinates are fractions of the page (0 to 1). */
export interface FlipBookHotspot {
  id: string;
  /** 1-based page of the book. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Accessible name of the hotspot, and the title of its popover. Default "Hotspot". */
  label?: string;
  /** Shown in a popover next to the hotspot when it is activated. */
  content?: ReactNode;
  /** Makes the hotspot a link. */
  href?: string;
  /** Called when the hotspot is activated. */
  onClick?: (hotspot: FlipBookHotspot) => void;
}

/** A link followed from a PDF page. */
export type FlipBookLink =
  | { type: "page"; /** 1-based page of the book. */ page: number }
  | { type: "url"; url: string };

export interface UrlStateOptions {
  /** Name of the query or hash parameter. Default `"page"`. */
  param?: string;
  /** Use the hash (`#page=5`) instead of the query string (`?page=5`). Default false. */
  hash?: boolean;
  /** `"replace"` (default) keeps one history entry; `"push"` adds one per page turn. */
  history?: "replace" | "push";
}

export interface PersistStateOptions {
  /** Storage key. Required unless `source` is a URL. Prefixed, so it cannot clash with yours. */
  key?: string;
  /** Where to save. Default `window.localStorage`. */
  storage?: StorageLike;
  /** Also remember zoom, if it was above fitted. Default true. */
  zoom?: boolean;
}

/** Which toolbar features are on and usable. Handy for a custom toolbar. */
export interface FlipBookFeatures {
  zoom: boolean;
  fullscreen: boolean;
  thumbnails: boolean;
  bookmarks: boolean;
  download: boolean;
  print: boolean;
  share: boolean;
  search: boolean;
  outline: boolean;
}

export interface FlipBookTurnEvent {
  fromPage: number;
  toPage: number;
}

/** Settings for the book itself, shared by `<FlipBook>` and `<FlipBookProvider>`. */
export interface FlipBookBookProps {
  /**
   * A PDF to show: a URL, `URL`, `File`, `Blob`, `ArrayBuffer` or `Uint8Array`.
   * Every page of the document becomes a page of the book. Pass either
   * `source` or `pages`. URLs must allow this origin (CORS). Keep the value
   * stable between renders: changing it loads a new document.
   */
  source?: PdfSource;
  /** Pages to show: image URLs, images, React pages, or single PDF pages. */
  pages?: readonly FlipBookPageInput[];
  /** PDF.js worker, render quality, password and memory settings. */
  pdf?: PdfOptions;
  /**
   * Called when a PDF needs a password. Answer with `callback(password)`, or
   * `callback(null)` to give up. Without this, a built-in dialog is shown.
   */
  onPassword?: (callback: (password: string | null) => void, reason: PasswordReason) => void;
  /** Rendered pages kept in memory. Default 10. */
  cacheSize?: number;
  /**
   * Zoom and pan: pinch, double-tap or double-click, Ctrl+wheel, the `+`, `-`
   * and `0` keys, and the zoom methods of the controller. Default true.
   */
  zoom?: boolean;
  /** 1 is the fitted size. Default 1. */
  minZoom?: number;
  /** Default 4. */
  maxZoom?: number;
  /** Step for `zoomIn()`, `zoomOut()` and the `+` / `-` keys. Default 0.25. */
  zoomStep?: number;
  /** Zoom a double-tap or double-click jumps to, or `false` to turn it off. Default 2. */
  doubleTapZoom?: number | false;
  /**
   * `"ctrl"` zooms on Ctrl or Cmd plus wheel, which is also how a trackpad
   * pinch arrives. `true` zooms on a plain wheel. `false` never zooms. Default `"ctrl"`.
   */
  wheelZoom?: boolean | "ctrl";
  /**
   * Turn pages by dragging or swiping them. While dragging, text on the page
   * cannot be selected. Default true.
   */
  dragToTurn?: boolean;
  /**
   * The browser's fullscreen button and keyboard shortcut (`F`). Where the
   * Fullscreen API is unavailable (iPhone Safari), the viewer fills the window
   * instead. Default true.
   */
  fullscreen?: boolean;
  /** A thumbnail list, opened from the toolbar. Default false. */
  thumbnails?: boolean;
  /** Start with the thumbnail list open. */
  defaultThumbnailsOpen?: boolean;
  /**
   * Let the reader bookmark pages: a toolbar button, the `B` key, a ribbon on
   * bookmarked pages, a bookmark list, and optionally saving between visits.
   * `true` for the defaults, or an options object. Default false.
   */
  bookmarks?: boolean | BookmarkOptions;
  /** A download button. Needs a PDF `source`, or `download.url`. Default false. */
  download?: boolean | DownloadOptions;
  /** A print button that prints the pages, not the viewer. Image and PDF pages only. Default false. */
  print?: boolean | PrintOptions;
  /** A share button: the system share sheet, or copy the link. Default false. */
  share?: boolean | ShareOptions;
  /** Replaces the built-in share behaviour. */
  onShare?: (data: { url: string; title?: string; text?: string }) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
  /**
   * Search the text of PDF pages: a search panel, highlights on the pages,
   * next and previous result, and the `/` key. Image and React pages have no
   * text and are skipped. `true` for the defaults, or options. Default false.
   */
  search?: boolean | SearchOptions;
  onSearch?: (query: string) => void;
  onSearchResult?: (info: { query: string; count: number; truncated: boolean }) => void;
  /** A Contents panel built from the PDF's own bookmarks. Shown only if the PDF has some. Default false. */
  outline?: boolean;
  /** Make the links in PDF pages clickable. Only web addresses with safe schemes are followed. Default true. */
  links?: boolean;
  /** Called before a PDF link is followed. Return `false` to stop it. */
  onLinkClick?: (link: FlipBookLink) => boolean | void;
  /** Regions of pages that open a popover, run a callback or link somewhere. */
  hotspots?: readonly FlipBookHotspot[];
  /**
   * React drawn over a page, by page number. The layer lets pointer events
   * through; a single element you pass is made clickable for you.
   */
  overlays?: Readonly<Record<number, ReactNode>>;
  /**
   * Keep the current page in the address bar (`?page=5`) and open at it. Page
   * turns replace the history entry unless you ask for `"push"`. Wins over
   * `persistState` and `initialPage`.
   */
  urlState?: boolean | UrlStateOptions;
  /**
   * Remember the reader's page (and zoom) between visits. `true` keys it by
   * the PDF URL in `source`; give a string or `{ key }` otherwise.
   */
  persistState?: boolean | string | PersistStateOptions;
  /** The zoom settled on a new value. Fires once per change, not on every pinch frame. */
  onZoomChange?: (zoom: number) => void;
  /** `auto` shows two pages when the container is at least `breakpoint` wide. */
  mode?: FlipBookMode;
  direction?: FlipBookDirection;
  /** Show page 1 alone as a front cover (and an even last page as a back cover). */
  cover?: boolean;
  /** 1-based. */
  initialPage?: number;
  /** Container width in px at which `mode="auto"` switches to two pages. Default 640. */
  breakpoint?: number;
  /** Base page-turn duration in ms. Default 700. */
  duration?: number;
  /** What happens to navigation that arrives mid-turn. Default `queue`. */
  whileTurning?: WhileTurning;
  /** `auto` follows `prefers-reduced-motion`. Reduced motion makes page changes instant. */
  reducedMotion?: boolean | "auto";
  shadow?: boolean;
  /** 0..1. Default 0.5. */
  shadowIntensity?: number;
  /** How many pages either side of the visible ones to preload. Default 2. */
  preloadPages?: number;
  locale?: Partial<FlipBookLocale>;
  onReady?: () => void;
  onPageChange?: (page: number) => void;
  onPageTurnStart?: (event: FlipBookTurnEvent) => void;
  onPageTurnEnd?: (page: number) => void;
  onError?: (error: FlipBookError) => void;
  onDocumentLoaded?: (info: { numPages: number }) => void;
  /** A PDF page finished rendering. 1-based page number in the book. */
  onPageLoaded?: (page: number) => void;
  /** One page failed to load or render. The rest of the book keeps working. */
  onPageError?: (error: FlipBookError) => void;
}

export interface FlipBookStageProps {
  aspectRatio?: AspectRatioProp;
  /** Space kept free around the book, in px. Default 16. */
  padding?: number;
  /** `progress` is 0..1 while a PDF downloads, or null when unknown. */
  renderLoader?: (info: { progress: number | null }) => ReactNode;
  renderError?: (error: FlipBookError) => ReactNode;
  renderEmpty?: () => ReactNode;
}

export interface FlipBookProps extends FlipBookBookProps, FlipBookStageProps {
  /** CSS width. Default `"100%"`. */
  width?: number | string;
  /** CSS height. Default `"80vh"`. */
  height?: number | string;
  /** Any CSS background, including `"transparent"`. */
  background?: string;
  theme?: FlipBookTheme;
  className?: string;
  style?: CSSProperties;
  /** The toolbar at the bottom: navigation, zoom and the optional actions. Default true. */
  toolbar?: boolean;
  /** Replaces the whole toolbar. `controls` is the same object `useFlipBook()` returns. */
  renderToolbar?: (api: { controls: UseFlipBookResult }) => ReactNode;
  /** Previous / next buttons and page counter. Default true. */
  navigation?: boolean;
  /** Arrow keys, Home and End. Default true. */
  keyboard?: boolean;
}
