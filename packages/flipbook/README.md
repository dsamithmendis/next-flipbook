# next-flipbook

A realistic, responsive flipbook engine for React and Next.js.

Give it a PDF, images or React components and it gives you a book: a physical page-turn animation you can grab and drag, pinch and double-tap zoom, thumbnails, bookmarks, text search and a table of contents, single or two-page layout that follows the container size, keyboard navigation, accessible controls and right-to-left support. The engine has no React or Next.js dependency, and the React layer is a thin, SSR-safe shell around it.

> **Status: Phase 7 (0.7.0).** PDFs (PDF.js), images and custom React pages; drag, swipe and zoom; a toolbar with thumbnails, bookmarks, fullscreen, download, print and share; text search, the PDF's table of contents, clickable PDF links, hotspots, overlays, deep links and a saved reading place; bounded memory on very long PDFs, with benchmarks; linted, with end-to-end, accessibility and visual tests and CI. Not built yet: autoplay, hard pages, page curl, sound, plugins. The API only exposes what is implemented.

## Install

```bash
npm install next-flipbook
```

Requires React 18 or newer. The package is ESM-only. `pdfjs-dist` is installed with it and is loaded only when a PDF is shown, in its own chunk, so image-only books never download it.

## Quick start: a PDF

```tsx
// app/magazine/page.tsx
import { FlipBook } from "next-flipbook";

export default function Magazine() {
  return (
    <FlipBook
      source="/magazine.pdf"
      pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
      cover
      height="80vh"
    />
  );
}
```

`source` can be a URL, `File`, `Blob`, `ArrayBuffer` or `Uint8Array`. Remote PDFs must be readable from the browser (CORS).

**About the worker.** PDF.js parses documents in a Web Worker and needs a URL for it. If you do not set `pdf.workerSrc`, the worker is fetched from the jsDelivr CDN at the installed pdfjs-dist version, which is convenient for a first try but is an external request and fails under a strict Content-Security-Policy or offline. For production, serve it yourself: see [docs/pdf.md](docs/pdf.md) for Next.js (Webpack and Turbopack), Vite and plain Webpack.

## Quick start: images (Next.js App Router)

```tsx
// app/magazine/page.tsx
import { FlipBook } from "next-flipbook";

export default function Magazine() {
  return (
    <FlipBook
      pages={["/pages/1.jpg", "/pages/2.jpg", "/pages/3.jpg", "/pages/4.jpg"]}
      cover
      height="80vh"
    />
  );
}
```

```tsx
// app/layout.tsx: optional, adds hover and focus styles and the CSS variables
import "next-flipbook/styles.css";
```

`FlipBook` is a client component boundary, so you can render it directly from a Server Component as long as the props you pass are serializable (strings, numbers, plain objects). If you pass functions such as `render`, `renderLoader` or `onPageChange`, put the page in a file marked `"use client"`.

The viewer draws nothing on the server. It measures its container in the browser first, so the server HTML is a small shell and there is no hydration mismatch or flash of the wrong layout.

## Examples

```tsx
// Two pages on wide containers, one on narrow ones (the default)
<FlipBook pages={pages} mode="auto" />

// Right-to-left publications
<FlipBook pages={pages} direction="rtl" cover />

// Mix images and React
<FlipBook
  pages={[
    { type: "image", src: "/cover.jpg", width: 1200, height: 1600 },
    { type: "custom", component: <Welcome /> },
    { type: "custom", render: () => <Chart data={data} /> },
  ]}
/>

// A password-protected PDF: built-in dialog, or bring your own
<FlipBook source={file} onPassword={(answer, reason) => askUser(reason).then(answer)} />

// A PDF page in the middle of a book of other things
<FlipBook
  pages={[
    { type: "image", src: "/cover.jpg" },
    { type: "pdf", source: "/terms.pdf", page: 3 },
    { type: "custom", component: <Welcome /> },
  ]}
/>

// Everything on: thumbnails, bookmarks that persist, fullscreen, download, print, share
<FlipBook
  source="/catalog.pdf"
  thumbnails
  bookmarks={{ persist: true }}
  download print share
/>

// Search the text, show the PDF's own table of contents, keep the page in the address bar
// and remember where the reader stopped
<FlipBook source="/guide.pdf" search outline urlState persistState />

// Regions of a page that open a popover or link somewhere, and React drawn over a page
<FlipBook
  pages={pages}
  hotspots={[{ id: "map", page: 3, x: 0.1, y: 0.2, width: 0.4, height: 0.25, content: <p>Drawn in 1921.</p> }]}
  overlays={{ 1: <button onClick={start}>Start reading</button> }}
/>

// Drive it from outside
const ref = useRef<FlipBookController>(null);
<FlipBook ref={ref} pages={pages} />;
ref.current?.goToPage(10);
ref.current?.zoomIn();      // also: zoomOut, setZoom(2), fit, fitWidth, fitHeight, getZoom
ref.current?.search("train"); // also: nextSearchResult, previousSearchResult, clearSearch, getOutline
ref.current?.getCacheStats(); // what the viewer holds: cached pages, thumbnails, search index

// Build your own UI
<FlipBookProvider pages={pages}>
  <MyToolbar />        {/* calls useFlipBook() */}
  <FlipBookStage />
</FlipBookProvider>
```

## Props

| Prop | Default | Notes |
| --- | --- | --- |
| `source` | none | A PDF: URL, `File`, `Blob`, `ArrayBuffer` or `Uint8Array`. Pass `source` or `pages`, not both. Keep it referentially stable: a new value loads a new document. |
| `pages` | none | Strings (image URLs), `{ type: "image", src, alt?, width?, height? }`, `{ type: "custom", component? \| render? }` or `{ type: "pdf", source, page }`. |
| `pdf` | none | `workerSrc`, `renderScale`, `maxCanvasPixels`, `maxCacheBytes`, `maxTextCacheBytes`, `cleanupAfterPages`, `password`, `withCredentials`, `httpHeaders`, `maxConcurrentRenders`, `documentParams`, `loadPdfjs`. See [docs/pdf.md](docs/pdf.md). |
| `onPassword` | built-in dialog | `(answer, reason) => void`. Call `answer(password)` or `answer(null)` to give up. |
| `cacheSize` | `10` | Rendered PDF pages kept in memory. Pages that would not fit alongside the visible ones are not prefetched, so a large `preloadPages` with a small `cacheSize` cannot thrash. |
| `mode` | `"auto"` | `"single"`, `"double"` or `"auto"` (double from `breakpoint` px wide). |
| `breakpoint` | `640` | Container width, not window width. |
| `direction` | `"ltr"` | `"rtl"` mirrors the spine, turn direction and arrow keys. |
| `cover` | `false` | Page 1 alone as a front cover. With an even page count the last page is a back cover. |
| `initialPage` | `1` | 1-based. |
| `aspectRatio` | `"auto"` | `"auto"`, a number, or `"4/3"`. `auto` uses the first image page. |
| `width`, `height` | `"100%"`, `"80vh"` | Any CSS length. |
| `duration` | `700` | Base turn time in ms. |
| `whileTurning` | `"queue"` | `"ignore"` drops navigation that arrives mid-turn. |
| `shadow`, `shadowIntensity` | `true`, `0.5` | Dynamic shading during turns. |
| `reducedMotion` | `"auto"` | Follows `prefers-reduced-motion`; page changes become instant. |
| `theme` | none | `"light"` or `"dark"`. |
| `background` | CSS variable | Any CSS background, including `"transparent"`. |
| `toolbar`, `navigation`, `keyboard` | `true` | The bottom bar; its previous/next/counter; arrow keys, Home, End, `+` `-` `0` zoom, `F` fullscreen, `B` bookmark. |
| `fullscreen` | `true` | Button and `F`. Fills the window where the browser API is missing. |
| `thumbnails`, `defaultThumbnailsOpen` | `false` | Thumbnail panel: sidebar, or bottom sheet when narrow. |
| `bookmarks` | `false` | `true` or `{ value, defaultValue, onChange, persist, storage }`. The reader's own bookmarks, not a PDF's outline. |
| `download`, `print`, `share` | `false` | `true` or options: `{ filename, url }`, `{ scale }`, `{ url, title, text }`. See [docs/toolbar.md](docs/toolbar.md). |
| `onShare`, `onFullscreenChange` | none | Take over sharing; fullscreen entered or left. |
| `search`, `onSearch`, `onSearchResult` | `false` | Text search over the PDF pages: `/` key, panel, highlights. `true` or `{ minLength, maxResults }`. See [docs/search-and-links.md](docs/search-and-links.md). |
| `outline` | `false` | A Contents panel from the PDF's own bookmarks. Shown only if the PDF has some. |
| `links`, `onLinkClick` | `true` | Links inside PDF pages work: internal ones turn the book, web ones open in a new tab (`http`, `https`, `mailto`, `tel` only). `onLinkClick` can return `false` to stop one. |
| `hotspots` | none | `{ id, page, x, y, width, height, label?, content?, href?, onClick? }`. Coordinates are fractions of the page. |
| `overlays` | none | `{ [page]: ReactNode }` drawn over a page. |
| `urlState` | `false` | `true` or `{ param, hash, history }`. The address (`?page=5`) follows the page and opens the book there. |
| `persistState` | `false` | `true` (keyed by the PDF URL), a key, or `{ key, storage, zoom }`. Remembers the page and zoom between visits. |
| `renderToolbar` | none | Replace the bar. Receives `{ controls }`. |
| `dragToTurn` | `true` | Drag or swipe a page to turn it. Turns off text selection on pages while on. |
| `zoom` | `true` | Pinch, double-tap, wheel and key zoom, pan, and the controller's zoom methods. |
| `minZoom`, `maxZoom`, `zoomStep` | `1`, `4`, `0.25` | `1` is the fitted size. Set `minZoom={0.5}` to allow zooming out. |
| `doubleTapZoom` | `2` | Zoom a double-tap or double-click jumps to; `false` turns it off. |
| `wheelZoom` | `"ctrl"` | `"ctrl"`: Ctrl/Cmd + wheel and trackpad pinch. `true`: plain wheel. `false`: never. |
| `onZoomChange` | none | Fires once when a zoom settles, not on every pinch frame. |
| `preloadPages` | `2` | Pages either side of the visible ones to preload. |
| `padding` | `16` | Space around the book, in px. |
| `locale` | English | Partial map of every UI string. |
| `renderLoader`, `renderError`, `renderEmpty` | built-in | Custom states. `renderLoader` receives `{ progress }` (0..1) while a PDF downloads. |
| `onReady`, `onPageChange`, `onPageTurnStart`, `onPageTurnEnd`, `onError` | none | See `FlipBookProps`. |
| `onDocumentLoaded`, `onPageLoaded`, `onPageError` | none | PDF loaded (`{ numPages }`), a page finished rendering, one page failed (the rest keep working). |

Errors arrive as `{ code, message, cause?, page? }`. Codes: `INVALID_PDF`, `PDF_NOT_FOUND`, `NETWORK_ERROR` (offline or blocked by CORS), `PASSWORD_REQUIRED`, `PDF_WORKER_FAILED`, `PAGE_RENDER_FAILED`, `IMAGE_LOAD_FAILED`, `UNSUPPORTED_SOURCE`, `INVALID_ARGUMENT`.

Every value can be styled through CSS variables: `--flipbook-background`, `--flipbook-toolbar-background`, `--flipbook-toolbar-color`, `--flipbook-page-background`, `--flipbook-shadow`, `--flipbook-accent`.

## How it stays fast

- **Bounded DOM.** At most four pages exist at any moment (the two visible ones, plus the turning leaf's two faces), however long the document is. Spreads are computed arithmetically, so a 5,000-page book costs the same as a 5-page one.
- **No React renders per frame.** A page turn renders twice (start and end). The frames in between write `transform` and `opacity` straight to the DOM.
- **Gestures without renders.** While a page is held or a pinch is running, the page angle, shading and zoom are written straight to the DOM. React renders when a gesture starts and ends, not on every pointer move.
- **Image warm-up.** Images around the current page are decoded ahead of time and de-duplicated.
- **PDF pages on demand.** Only the visible pages and a few neighbours are rendered, nearest first, two at a time. Work that falls out of range is dropped before it starts.
- **Bounded memory.** Rendered pages live in a cache that evicts the page farthest from the reader first, never the pages on screen. Canvas size is capped (`maxCanvasPixels`) and shrunk to zero on eviction so the browser can reclaim it.
- **Right-sized renders.** Resolution follows the on-screen size and the device pixel ratio, in quarter steps so small resizes reuse the cache. A lower-resolution render is shown while the sharp one is drawn.
- **Clean shutdown.** Unmounting cancels animation frames, aborts image loads, cancels PDF renders and terminates the PDF.js worker.

## Gestures

| Gesture | Fitted size | Zoomed in |
| --- | --- | --- |
| One finger or mouse, horizontal drag | Turns a page; the page follows the pointer | Pans |
| Release | Finishes the turn past halfway or on a fast flick, otherwise springs back | |
| Vertical drag (touch) | Scrolls the page as normal | Pans |
| Two fingers | Pinch to zoom | Pinch and pan |
| Double-tap / double-click | Zooms to `doubleTapZoom` | Back to fitted |
| Ctrl/Cmd + wheel, trackpad pinch | Zooms about the pointer | Same |
| A second finger during a turn | Cancels the turn and starts a pinch | |

A drag never starts on a link, button or form field inside a page, and the click that ends a drag is swallowed. Panning or pinching can never turn a page. Full details in [docs/interaction.md](docs/interaction.md). The toolbar, thumbnails, bookmarks and actions are covered in [docs/toolbar.md](docs/toolbar.md); search, contents, links, hotspots, deep links and saved place in [docs/search-and-links.md](docs/search-and-links.md).

## Accessibility

The viewer is a labelled region that takes keyboard focus. Arrow keys, Home and End navigate (arrows swap in RTL), `+` `-` `0` zoom. Dragging is an extra way to turn pages, never the only one. Buttons have text labels and stay focusable at the ends of the book (`aria-disabled`). A polite live region announces the visible pages. The turning leaf is `aria-hidden`. `prefers-reduced-motion` turns page turns into instant changes.

## Browser support

Current Chrome, Edge, Firefox, Safari, iOS Safari and Chrome for Android. The page turn uses CSS 3D transforms, `ResizeObserver` and `requestAnimationFrame`.

## Packages and subpath imports

| Import | Contents |
| --- | --- |
| `next-flipbook` | React components, hooks and types |
| `next-flipbook/react` | Same React layer |
| `next-flipbook/core` | Framework-free engine, layout maths and animation helpers |
| `next-flipbook/image` | The image loader |
| `next-flipbook/pdf` | PDF session and manager, page cache, worker helpers (advanced) |
| `next-flipbook/actions` | Fullscreen controller, download, print and share helpers |
| `next-flipbook/styles.css` | Optional stylesheet |

`FlipBookControls` (component) and `FlipBookPageView` (component) are named so they do not collide with the `FlipBookController` and `FlipBookPage` types.

## Long PDFs and memory

Only the pages near the reader are drawn and kept: the visible spread, `preloadPages` either side, at most `cacheSize` rendered pages and `pdf.maxCacheBytes` of canvas, whatever the length of the document. Prefetching stops when the reader jumps away, thumbnails draw only when they stay in view, the search index has a byte budget, and PDF.js's own per-page memory is released when the reader is idle. `getCacheStats()` reports what is held. The numbers for 100, 500 and 1000 page documents, and the limits of those measurements, are in [docs/performance.md](docs/performance.md).

## Roadmap

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Monorepo, engine, image and custom pages, page turn, single/double, responsive, RTL, keyboard | **Done** |
| 2 | PDF.js loading, worker, page rendering, page cache, passwords | **Done** |
| 3 | Mouse and touch drag, velocity, spring-back, zoom, pinch, double-tap | **Done** |
| 4 | Toolbar, thumbnails, fullscreen, download, print, share, **bookmarks** | **Done** |
| 5 | Search, outline (the PDF's own bookmarks), PDF links, hotspots, overlays, deep linking, saved place | **Done** |
| 6 | Prefetch tuning, memory bounds and cleanup, benchmarks on 100 to 1000 page PDFs, cache statistics | **Done** |
| 7 | ESLint, Playwright end-to-end, accessibility and visual tests, a playground, CI, release workflow | **Done**, except a docs site and the first npm publish |

Not yet in the API, on purpose: `hardPages`, `pageCurl`, `autoplay`, `sound`, plugins, annotations, OCR and a selectable text layer.

## Development

```bash
npm install
npm run build        # build the package
npm test             # unit, DOM and real PDF.js tests
npm run lint
npm run typecheck:all
npm run dev          # build, then start the Next.js demo (the /playground page is there)
npm run build:demo && npm run e2e   # Playwright against the built demo
npm run verify:pack  # install the packed tarball into an empty project and use it
```

What is tested, how, and what none of it proves: [docs/testing.md](docs/testing.md).

Benchmarks (not part of `npm test`; see [benchmarks/README.md](benchmarks/README.md)):

```bash
node --expose-gc benchmarks/pipeline.mjs      # the PDF pipeline in Node, 10 to 1000 pages
node benchmarks/browser.mjs                   # a real Chromium on the demo's /large-pdf route
```

What was measured, on what, and what it does not show: [docs/performance.md](docs/performance.md).

Layout: `packages/flipbook` is the library, `demo/next-app` is the App Router demo, `benchmarks` holds the benchmarks, `docs` holds design notes. See [docs/architecture.md](docs/architecture.md).

## Author

Samith Mendis ([@dsamithmendis](https://github.com/dsamithmendis)) · samithmendis.01@gmail.com

## License

MIT. See [LICENSE](LICENSE).
