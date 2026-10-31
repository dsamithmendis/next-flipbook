# Architecture

## Layers

```text
FlipBook / FlipBookProvider / FlipBookStage   react/   thin React shell
              |
        FlipBookEngine                          core/    state machine, no DOM, no React
              |
  spreads · sizing · turn visuals · tween       core/    pure functions
```

The engine never touches the DOM. React reads it through two channels:

- `subscribe` + `getState` for coarse changes (page, view, turn start and end). Fits `useSyncExternalStore`.
- `subscribeFrame` for per-frame progress. The stage writes styles straight to elements, so a turn does not re-render React.

## The spread model

Pages are 1-based. A **spread** is what is visible at one reading position:
`{ verso, recto }`. Verso is the side already turned past (left in LTR), recto the side being turned towards (right in LTR). Using verso/recto instead of left/right makes RTL a mirror of layout, not a second code path.

| Config | Spreads for 6 pages |
| --- | --- |
| single | `[-,1] [-,2] [-,3] [-,4] [-,5] [-,6]` |
| double | `[1,2] [3,4] [5,6]` |
| double + cover | `[-,1] [2,3] [4,5] [6,-]` |

Spreads are computed from an index, so nothing is stored per page.

## The page turn

A turn between spread `E` (earlier) and `L` (later) uses four surfaces, for forward and backward turns and for multi-spread jumps alike:

| Surface | Content |
| --- | --- |
| Static verso slot | `E.verso` |
| Static recto slot | `L.recto` (waits under the leaf) |
| Leaf front | `E.recto` |
| Leaf back | `L.verso` |

The leaf is a `preserve-3d` element hinged at the spine with `rotateY`, front and back faces using `backface-visibility: hidden`. Lighting and cast shadows are opacity-animated overlays derived from the leaf angle (`computeTurnVisuals`). In single view the book box clips the leaf as it swings out.

Lone covers are centred by shifting the book half a page and interpolating that shift during the turn.

## State machine

```text
IDLE --next/prev/goTo--> TURNING --complete--> IDLE
                            |  ^
   navigation while turning |  | queued target starts the next turn
                            v  |
                          (queue | ignore)
```

The logical position commits when a turn starts, so `getCurrentPage()` reports the destination immediately. `whileTurning: "queue"` keeps only the latest target. Layout changes (view, cover, page count, direction) end a running turn and keep the reader on the same page.

Held pages add three more states:

```text
IDLE --beginDrag--> DRAGGING --endDrag(complete)--> SETTLING --> IDLE
                       |                                ^
                       +--endDrag(cancel)--> SETTLING (spring back)
```

`dragTo(progress)` moves the held page and never changes the reader's position. Releasing with `complete: true` commits the new spread at once (so the counter and `onPageChange` update at release) and eases the page the rest of the way; `complete: false` springs it back with an exponential-decay ease and the reader never moves. Both end through the same `endTurn()` as a scripted turn, so queued navigation and `turnend` behave identically.

Progress means the same thing for scripted and held turns: 0 is where the turn began and 1 is fully turned, forward or backward, so the renderer needs no special case.

## Gestures and zoom

```text
pointer events --> useGestures (React, DOM listeners) --> GestureRecognizer (pure)
                                                              |
                          turn: FlipBookEngine.beginDrag / dragTo / endDrag
                          pan, pinch, double-tap: ZoomController
```

- **GestureRecognizer** (`core/interaction`) is a small state machine: `pending` until the pointer moves past a slop distance, then `turn`, `pan`, `pinch` or `ignored`. It decides by direction, by whether the book is zoomed and by how many pointers are down. It owns no DOM and no timers, so every rule is tested by feeding it events.
- **dragProgress** turns pointer travel into progress. The page's free edge follows the pointer, so progress follows the cosine of the page angle.
- **ZoomController** (`core/zoom`) keeps a live transform (`zoom`, `panX`, `panY`) that is written to the DOM on every change, and a coarse snapshot that only changes when `zoomed` flips or the zoom settles. That is what keeps pinching from re-rendering React.
- The zoom layer is a plain wrapper around the book with `transform: translate3d() scale()`. It deliberately has no `will-change`, so the browser rasterises at the final scale and zoomed pages stay crisp.
- Zoom pivots about the centre of the stage, so a focal point is a pointer position relative to that centre, and `pan' = focal - (zoom' / zoom) * (focal - pan)` keeps the content under the pointer fixed.

## Shared UI state, bookmarks and actions

```text
FlipBookProvider
   |-- FlipBookEngine      pages and turns
   |-- ZoomController      zoom and pan
   |-- BookmarkStore       the reader's bookmarked pages (+ optional storage)
   |-- UiStore             open panel, notice, print progress, fullscreen mode
   |-- FullscreenController, download / print / share helpers
   +-- createController()  one stable object over all of the above
```

- **Everything the toolbar touches lives outside React**, in small stores with `subscribe` and an immutable `getSnapshot`. That is why `ref.current.toggleBookmark()` or `openPanel("thumbnails")` works from anywhere, and why the toolbar, the panel and a custom UI always agree.
- **BookmarkStore** keeps a sorted, unique list. User actions persist and are reported with origin `user`; `replace` and `hydrate` are `external`, which stops a controlled `value` from echoing back. Out-of-range pages are hidden, not erased, until the book's size is known.
- **Persistence is read after mount**, in an effect, so server and first client render match. Storage access is wrapped everywhere because even reading `localStorage` can throw.
- **Features resolve to flags** (`features`), combining the prop with what is actually possible: the download button needs a target, the print button needs an image or PDF page. The controller reads them at call time, so an action whose prop is off is a no-op.
- **Thumbnails** share the PDF render queue but not the page cache: they queue behind real pages, carry a waiter count so cancelled ones cost nothing, and live in their own small cache.
- **Print renders outside the cache**, one page at a time, straight to a JPEG object URL, and hands the pages to a hidden iframe. `printPages` is written against a `PrintFrame` interface, so its sequencing, skipping and cancellation are tested without a browser dialog.

## Search, contents, links and reading position

```text
PdfSession                       FlipBookProvider
   getPageText(page)  ---------->  SearchController   (query, results, current, highlights)
   getLinks(page)     ---------->  PdfPageView link layer
   getOutline()       ---------->  useBookContent  -> FlipBookTOC
                                   useReadingPosition (URL + storage)
```

- **Text becomes rectangles in the PDF layer.** `PdfSession.getPageText` turns PDF.js text items into a string plus the runs that make it up, each with a rectangle expressed as a fraction of the page (`core/search/text.ts`). Everything after that is framework-free and knows nothing about PDF.js. A match is mapped back to rectangles by interpolating character positions inside each run.
- **SearchController** is a store like the others (`subscribe`, immutable `getSnapshot`). `search()` cancels the previous run, reads pages one at a time through an abortable source, and publishes after each page so results appear progressively. Pages that cannot be read are skipped. It selects the first result at or after the reader's page, and `onCurrent` is how the React layer turns the book. `getHighlights()` is memoised per snapshot, so reading it on every render is cheap.
- **Positions, not page numbers.** The book can mix PDF, image and custom pages, so search results, links and outline entries are expressed as positions in the book. `react/outline.ts` maps a document page to its position and back; an outline entry that points outside the book is shown as plain text, and a link that does is not drawn.
- **Links are filtered at the source.** `getLinks` resolves named and explicit destinations to pages and passes every URL through `safeUrl` (an allow-list: `http`, `https`, `mailto`, `tel`), so an unsafe address never reaches the DOM.
- **Overlays share one layer.** Highlights, your overlay and hotspots live in a single page-sized layer that lets pointer events through, so gestures keep working over them. The hotspot popover is rendered once, at the zoom layer, not inside a page, so a page cannot clip it.
- **Reading position is restored after mount**, once the page count is known: the address wins, then saved state, then `initialPage`, applied with `jumpToPage`, an instant jump with no animation. Saving is debounced; storage and `history` calls are guarded.

## PDF pipeline

```text
FlipBookProvider
   |  owns
PdfManager ---- PageCache (one per viewer, shared by all documents)
   |  one per source
PdfSession ---- load -> password? -> ready
   |             render queue (nearest first, N at a time)
PdfPageView  <- cached canvas, moved into the page (not copied)
```

- **PdfManager** keeps one `PdfSession` per distinct source (URLs by value, binary data by reference), opens and closes them to match what the book uses, and owns the shared cache. `focus()` is called whenever the visible pages change. It first makes a plan: the visible pages always, then the nearest pages outward until the next one would not fit the cache's entry or byte limit. It pins the plan in the cache, cancels prefetches outside it (queued ones are dropped, running ones are aborted), and requests the rest, visible pages first.
- **PdfSession** loads the document, answers password prompts, and runs the render queue. Requests for the same page and scale share one render. Page 1's size is read before the session reports `ready`, so the viewer knows its aspect ratio before drawing anything.
- **PageCache** (`core/cache`) evicts the entry farthest from the reader first, ties to the least recently used, and skips pinned entries and canvases that are attached to the document. It counts hits, misses, evictions and its peaks, which `getCacheStats()` returns.
- **The prefetch plan has to fit the cache.** A window larger than the cache is the one way to waste work here: the far end of the window is evicted by the near end before it is ever shown. Planning against the cache's own limits, rather than trusting `preloadPages`, removed that (about 3 pages drawn per page read became about 1 in the benchmark with `preloadPages` larger than `cacheSize`).
- **A running prefetch can be aborted.** A render that is no longer near is cancelled, and a request for the same key replaces a job that was aborted but is still unwinding, so a reader who jumps away and back is not handed a dead job.
- **PDF.js memory is released when idle.** PDF.js keeps a page object for every page it has opened, in the main thread and in the worker, whatever our caches hold. After `cleanupAfterPages` pages, once the render queue is empty, the session calls `doc.cleanup()`, as the PDF.js viewer does. Every other use of the document waits behind it (`withDocument`), because PDF.js must not draw during a cleanup.
- **The text index is a byte-budgeted LRU** (`maxTextCacheBytes`). A page's cost is its characters plus a fixed amount per run, because runs, not characters, dominate for text-heavy pages.
- **Thumbnails are cheap to keep alive.** Each item is memoised, so turning a page or adding a bookmark redraws the items that changed, not the list. A thumbnail draws only after it has stayed near the viewport for a moment, so dragging the scrollbar through a thousand pages draws where it stops, not everything it passed, and the list goes straight to the current page rather than gliding past hundreds of thumbnails. One button per page stays in the DOM; see [performance.md](performance.md) for what that costs at 1000 pages.
- **Cache keys** include a render scale rounded to a quarter step, so a small resize reuses the cached render and a large one triggers a sharper render while the old canvas stays visible as a placeholder.
- **Structural PDF.js types** (`pdf/types.ts`) describe only what we use, so a different pdfjs-dist version, the legacy build or a test fake can be substituted through `pdf.loadPdfjs`.
- A book made from `source` has no pages until the document loads. The engine remembers `initialPage` and applies it once the page count arrives, without reporting that as a page change.

## SSR rules

- No browser global is read at module load. `requestAnimationFrame`, `matchMedia`, `ResizeObserver` and `Image` are looked up only when called.
- The stage renders nothing but a shell until the browser has measured the container.
- Client-only files carry `"use client"`, and the package is emitted file by file so directives survive and unused code tree-shakes.

## Adding a page type (extension point)

Page content is resolved in one place, `FlipBookPageView`: image, custom React, or PDF page. A new page type adds a variant to `FlipBookPage` and a branch there; the engine only ever sees a page count.
