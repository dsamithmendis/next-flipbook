# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.0]

Tooling, tests and publishing. The library changes are small and are listed under Changed and Fixed.

### Added

- **ESLint** for the whole repository (`npm run lint`, zero warnings allowed): `typescript-eslint` with type information, and the `react-hooks` rules for every component and hook. No inline disables; a rule that is off is off in `eslint.config.mjs`, with a reason.
- **Playwright end-to-end tests** (`npm run e2e`, 71 tests) against the built demo, in desktop Chromium and a Pixel 7: turning, drag, keyboard, resize, right to left, toolbar, thumbnails, bookmarks, search, contents, links, hotspots, deep links, passwords, a 1000 page PDF, the legacy PDF.js build, and the playground. A test fails on any console error.
- **Accessibility tests** (axe-core) of the viewer in 8 states in the default theme and 7 in the dark theme, plus a keyboard-only pass through the toolbar.
- **Visual tests** (`npm run e2e:visual`, 10 screenshots of the viewer, light and dark). They are opt-in and advisory in CI: see `docs/testing.md` for why, and for the workflow that makes baselines in CI's own image.
- **`/playground`** in the demo: controls for the props, the JSX for the viewer as it is (only the props that differ from the defaults), and a log of the events it reports. It stands in for Storybook; see `docs/testing.md`.
- **`npm run verify:pack`**: packs the library, installs the tarball into an empty project, imports every entry point in Node, renders a book on the server, and type-checks a consumer under `Bundler` and `NodeNext` resolution.
- **CI** runs lint, types, unit tests, the build, `verify:pack` and the demo build on Node 22 and 24, then the end-to-end tests. A **Release** workflow publishes to npm with provenance when a `vX.Y.Z` tag is pushed, after checking that the tag matches `package.json` and that `CHANGELOG.md` has a section for it, and creates the GitHub release from that section. `scripts/release-notes.mjs` extracts it.
- `docs/testing.md`, and the contributing guide now describes the checks.
- `FlipBookLocale.zoomLabel`: the name of the group of zoom buttons.

### Changed

- The accessible name of the zoom percentage button is now `Fit to window, 100%` (the percentage it shows), where it was `Fit to window`, so that the name contains the words on the button. `locale.fit` takes `{percent}`. The group of zoom buttons was named "Zoom in"; it is now named by `locale.zoomLabel`, "Zoom". If you translate the locale, update both.
- `pages` is read when its identity changes, not on every render. Changing the array in place, without a new array, no longer updates the book. Pass a new array, as React expects.
- The PDF demo for passwords shows a message when the file cannot be fetched, instead of staying blank.
- Interfaces of the controller and the engine's navigation and zoom controls declare their members as function properties (`next: () => void`) rather than methods, which is what `@typescript-eslint/unbound-method` expects. Using them is unchanged.
- Development: `vitest` 5, `eslint` 10, `@playwright/test` 1.56.

### Fixed

- A thumbnail that is already cached is drawn on the render that needs it, instead of one render later.

## [0.6.0]

Performance and memory on long documents, with benchmarks.

### Added

- **`getCacheStats()`** on the controller: what the viewer holds, as `{ pages, thumbnails, text }`. The page and thumbnail caches report entries, bytes, hits, misses, evictions and their peaks; the search index reports pages and bytes. `PageCache` gained `stats()`, `resetStats()` and `getLimits()`. Types `FlipBookCacheStats` and `FlipBookCacheControls`.
- **`pdf.maxTextCacheBytes`** (default 32 MB): the search index is now a byte-budgeted LRU. `estimateTextBytes` in `next-flipbook/core`.
- **`pdf.cleanupAfterPages`** (default 48, `0` to turn off): once that many pages have been opened and the reader is idle, PDF.js is told to release what it keeps for every page it has opened.
- **Benchmarks** in `benchmarks/`: `pipeline.mjs` (the PDF pipeline in Node, 10 to 1000 pages) and `browser.mjs` (a real Chromium: frame timing during page turns, DOM and canvas counts, heap, jumps, search, the thumbnail panel, and a leak check that mounts and unmounts the book). `docs/performance.md` has the numbers and what they do not show.
- Demo route **`/large-pdf`**: generated PDFs of 100, 500 and 1000 pages with a live panel of cache and memory figures.
- Tests: bounded prefetch, aborting prefetch, idle cleanup (never while rendering), cache statistics, thumbnail redraw counts and scrolling, and leak tests for mounting and unmounting a book, including under `StrictMode`.

### Changed

- **Prefetching fits the cache.** The prefetch window is planned against `cacheSize` and `pdf.maxCacheBytes`: visible pages first, then the nearest pages outward until the next would not fit. Before, a `preloadPages` larger than `cacheSize` drew pages and evicted them before they were seen (about 3 pages drawn per page read in the benchmark, 2.8 to 3.3 between runs; now about 1.0 to 1.1).
- **A jump cancels prefetches that are no longer near**, including ones already drawing.
- **Thumbnails**: items are memoised, so turning a page or toggling a bookmark redraws the items that changed instead of the whole list (300 pages: 600 redraws per turn became 8 or fewer). A thumbnail draws only after it has stayed near the viewport briefly, so dragging through a long list does not draw everything it passes. The list goes straight to the current page when it is far away, instead of gliding past hundreds of thumbnails (opening the panel at page 400 of 1000 drew 44 thumbnails and took about 1.2 s to show the right ones; it now draws 9 in about 0.2 s).
- Reading a 1000 page PDF to page 200 leaves a 3 MB JavaScript heap in the Node benchmark, down from 12.9 MB, and searching all of it 15 MB, down from 47 MB.
- `PdfDocumentProxy` has an optional `cleanup()`; `FlipBookController` includes `getCacheStats`.

### Fixed

- The demo had no favicon, which logged a 404 on every load.

## [0.5.0]

### Added

- **Search** (`search`): a panel and the `/` key, a progressive page-by-page search that can be cancelled, highlights on the page (the selected result in a different colour), a result list with snippets, `Enter` / `Shift+Enter` to step through, and the first result at or after the current page selected. Case-insensitive, whitespace-tolerant, literal characters, capped by `maxResults`. `onSearch` and `onSearchResult`; controller methods `search`, `nextSearchResult`, `previousSearchResult`, `clearSearch` and `getSearchResults`.
- **Contents** (`outline`): a nested, expandable panel built from the PDF's own bookmarks, mapped onto book pages, marking the section being read. `getOutline()` on the controller.
- **PDF links** (`links`, on by default): link annotations become real links over the page. Internal and named destinations turn the book; web links open in a new tab. Only `http`, `https`, `mailto` and `tel` are followed. `onLinkClick` can stop a link.
- **Hotspots** (`hotspots`) with a popover, a link or a callback, and **overlays** (`overlays`) of your own React over a page. Both are positioned by fractions of the page. `Escape` closes a popover before anything else.
- **Deep links** (`urlState`): the page in the query string or hash, replace or push history, back and forward follow.
- **Saved place** (`persistState`): the page and zoom are remembered between visits. The address wins over the saved place, which wins over `initialPage`.
- `engine.jumpToPage()`: an instant jump that settles any turn in progress.
- Framework-free `SearchController`, `buildPageText`, `compileQuery`, `findMatches` and `readReadingState` / `writeReadingState` in `next-flipbook/core`; `safeUrl` in `next-flipbook/pdf`.
- `FlipBookSearch`, `FlipBookTOC`, `PageOverlays` and `HotspotPopover` components.
- Demo routes `/search`, `/hotspots` and `/deep-links`, a generated `guide.pdf` with text, contents and links; `docs/search-and-links.md`.

### Changed

- The side panel has four tabs (thumbnails, bookmarks, search, contents) and is wider for search and contents.
- `FlipBookFeatures` now includes `search` and `outline`; `FlipBookController` includes the search and outline methods.
- The turning leaf no longer takes pointer events.

## [0.4.0]

### Added

- A real toolbar: previous/next/counter, zoom out/percentage/in, and buttons for each enabled feature. `toolbar`, `navigation`, `zoom`, `fullscreen` switch parts on and off; `renderToolbar`, `FlipBookToolbar` (with `children`) and `FlipBookToolbarButton` build your own.
- **Bookmarks**: the reader bookmarks pages with a button or the `B` key. Ribbons on bookmarked pages and thumbnails, a bookmark list, notices, `bookmarks` options (`value`, `defaultValue`, `onChange`, `persist`, `storage`) and controller methods. Saved in `localStorage` (or any storage) after hydration, synced across tabs, safe when storage is blocked.
- **Thumbnails**: sidebar, or a bottom sheet on narrow containers; lazy drawing with IntersectionObserver, current pages highlighted and kept in view, keyboard navigation, `thumbnail` on image pages, small cached PDF renders that never evict real pages.
- **Fullscreen** with the browser API and a fill-the-window fallback, `F` and Escape, `onFullscreenChange`.
- **Download** (same-origin direct, cross-origin in a new tab, in-memory sources via a revoked object URL), **Print** (pages only, one at a time, cancellable, flat memory), **Share** (system sheet or copy the link, `onShare`).
- Controller methods for fullscreen, bookmarks, the panel and the actions; `useFlipBook()` now also returns `ui`, `bookmarks`, `currentBookmarked`, `features` and `locale`.
- Framework-free `BookmarkStore`, `UiStore`, `FullscreenController` and the print, download and share helpers (`next-flipbook/actions`).
- Demo routes `/features` and `/custom-toolbar`; `docs/toolbar.md`.

### Changed

- `FlipBookControls` is now the navigation group of the toolbar, and still works on its own.
- Right-to-left books mirror the whole toolbar.
- New error codes `PRINT_FAILED` and `DOWNLOAD_FAILED`.

## [0.3.0]

### Added

- Drag-to-turn with mouse, touch and pen through Pointer Events. The page follows the pointer, and on release it either finishes the turn or springs back, decided by how far it was pulled and how fast the release was.
- Engine drag API (`beginDrag`, `dragTo`, `endDrag`) and `dragging` / `settling` states, alongside the existing scripted turns.
- Zoom and pan: pinch with two fingers, double-tap or double-click, Ctrl/Cmd+wheel (and trackpad pinch), the `+` `-` `0` keys, drag to pan, pan clamped to the book.
- Controller methods `zoomIn`, `zoomOut`, `setZoom`, `fit`, `fitWidth`, `fitHeight`, `getZoom`, and `zoomState` from `useFlipBook()`.
- Props `zoom`, `minZoom`, `maxZoom`, `zoomStep`, `doubleTapZoom`, `wheelZoom`, `dragToTurn`, `onZoomChange`.
- Framework-free `GestureRecognizer` and `ZoomController` in `next-flipbook/core`.
- PDF pages re-render sharper once the zoom settles; pages prepared in advance stay at the fitted size.
- Demo route `/zoom`.

### Changed

- A second finger always cancels a turn in progress and starts a pinch; a drag never starts on a link, button or form field, and the click that follows a drag is swallowed.
- Under reduced motion a swipe turns the page instantly instead of dragging it.
- `FlipBookController` is now `FlipBookNavigation & FlipBookZoomControls`.
- While drag-to-turn or zoom is on, text on a page cannot be selected (`dragToTurn={false}` and `zoom={false}` restore it).

## [0.2.0]

### Added

- PDF support through PDF.js: `source` (URL, `URL`, `File`, `Blob`, `ArrayBuffer`, `Uint8Array`) and `{ type: "pdf", source, page }` pages that mix with images and React pages.
- Worker configuration with `pdf.workerSrc`, a documented self-hosting path, and a CDN fallback when nothing is set.
- Password-protected PDFs: built-in accessible dialog, `onPassword` for custom UI, `pdf.password`.
- On-demand rendering: visible pages first, then neighbours, nearest first, with a concurrency limit and cancellation of work that falls out of range.
- `PageCache`: bounded, evicts the page farthest from the reader first, never evicts pages on screen, releases canvas memory.
- Render resolution that follows on-screen size and device pixel ratio, capped by `pdf.maxCanvasPixels`.
- Download progress for the loader (`renderLoader({ progress })`), `onDocumentLoaded`, `onPageLoaded`, `onPageError`, `cacheSize`.
- Structured PDF errors: `INVALID_PDF`, `PDF_NOT_FOUND`, `NETWORK_ERROR`, `PASSWORD_REQUIRED`, `PDF_WORKER_FAILED`, `PAGE_RENDER_FAILED`, `UNSUPPORTED_SOURCE`.
- `next-flipbook/pdf` subpath, `pdf.documentParams` and `pdf.loadPdfjs` (legacy build, self-hosted assets).
- Demo routes `/pdf`, `/pdf-password`, `/pdf-bundled`.

### Changed

- `pages` is optional (use `source` or `pages`). `renderLoader` now receives `{ progress }`.
- `pdfjs-dist` is a dependency, loaded lazily into its own chunk.
- Development requires Node 22.13 or newer (pdfjs-dist 6).

## [0.1.0]

### Added

- Framework-free `FlipBookEngine`: spreads, turn state machine, queueing, reduced motion.
- React layer: `FlipBook`, `FlipBookProvider`, `FlipBookStage`, `FlipBookControls`, `FlipBookPageView`, `useFlipBook`.
- Image and custom React pages, with lazy image decoding and preloading.
- Realistic 3D page turn with dynamic shading, cover mode, single and double view, `auto` mode by container width.
- Right-to-left books, keyboard navigation, live-region announcements, localisable strings.
- SSR-safe, `"use client"` aware ESM build with subpath exports.
- Next.js App Router demo app.
