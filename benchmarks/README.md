# Benchmarks

Two benchmarks, because they answer different questions. Neither is part of `npm test`: they take minutes and their numbers depend on the machine. The results from the machine this was last run on, with what they do and do not show, are in [`docs/performance.md`](../docs/performance.md).

| | What it measures | Needs |
| --- | --- | --- |
| [`pipeline.mjs`](pipeline.mjs) | The PDF pipeline in Node: load, first page, read-through with prefetch, jumps, search, memory, teardown. | The built package. |
| [`browser.mjs`](browser.mjs) | A real Chromium on the demo: page-turn frame timing, DOM and canvas counts, heap, jump latency, search, the thumbnail panel, and cleanup after leaving the page. | The built demo, Playwright, Chromium. |

Both generate their PDFs (`lib/big-pdf.mjs`): dense pages of text, an optional outline, a fixed seed. The demo's `/large-pdf` page uses the same generator, so what you see by hand is what is measured.

## The pipeline benchmark

```sh
npm run build -w next-flipbook
node --expose-gc benchmarks/pipeline.mjs --pages=10,50,100,500,1000 --json=pipeline.json
```

Every size runs in its own process, so one size's memory does not pollute the next.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--pages` | `10,50,100,500,1000` | Document sizes. |
| `--cache` | `10` | Pages the cache keeps (`cacheSize`). |
| `--radius` | `2` | Pages prefetched on each side (`preloadPages`). Try `--radius=8 --cache=10` to see the cache thrash on purpose. |
| `--width`, `--dpr` | `600`, `1` | Rendered page width in CSS pixels, and device pixel ratio. |
| `--dwell` | `100` | Milliseconds spent on each page of the read-through. |
| `--turns`, `--jumps` | `100`, `40` | Pages read, and random jumps made. |
| `--fastdwell`, `--rapiddwell` | `25`, `5` | Dwell for the fast read and the rapid-jump runs. |
| `--query` | `qwxz` | The search term. The default is not in the text, so every page has to be read; a common word hits the result cap and stops early. |
| `--json` | none | Write the results here. |

It runs PDF.js on the main thread in Node (a browser parses in a worker), so time to first page here is an upper bound. The page canvas is `@napi-rs/canvas`, not a browser's.

## The browser benchmark

```sh
npm run build:demo
npm run start -w next-flipbook-demo -- -p 3100     # leave this running

# Playwright is not a dependency of this repository. Install it where Node can find it, plus Chromium.
npm i --no-save playwright && npx playwright install chromium
node benchmarks/browser.mjs --json=browser.json
```

Without a local install, point at one: `--playwright=/path/with/node_modules/` or `PLAYWRIGHT_DIR`, and `--chromium=/path/to/chrome` or `CHROMIUM_PATH` to use a Chromium you already have.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--url` | `http://localhost:3100` | Where the demo is running. |
| `--pages` | `100,500,1000` | Which of the demo's PDFs to open. |
| `--turns`, `--dwell` | `40`, `120` | Page turns made, and milliseconds spent looking at each spread. |
| `--jumps` | `12` | Random jumps, each at least four pages from the current one. |
| `--cycles` | `8` | Times the book is opened and left in the cleanup check. |
| `--cleanup=false` | on | Skip the cleanup check. |
| `--params` | none | Extra query string for the demo page. `--params=cleanup=0` turns off the idle release of PDF.js memory, to compare. |
| `--query` | `qwxz` | The search term (see above). |
| `--width`, `--height`, `--dpr` | `1280`, `900`, `1` | The browser window. |
| `--polyfill` | `auto` | See below. |
| `--json` | none | Write the results here. |

The exit code is 1 when the cleanup check finds a leak, so this can gate a CI job.

### What each number is

* **Time to first page** is milliseconds from the start of navigation until the first page is drawn. It includes loading the page, starting the PDF.js worker and fetching the first ranges from localhost. A real network adds to it.
* **Frame timing** is the gap between `requestAnimationFrame` callbacks while a turn animation runs, so it is the smoothness of the turn while the next pages render. `fps` is the mean; `p95`, `p99` and `max` are the gaps. A gap of 16.7 ms is a 60 Hz frame. Long tasks are main-thread tasks over 50 ms that overlap a turn. The first turn is reported apart from the rest, because it pays for one-time work.
* **Pages drawn after the turn ends** is how long the reader sees an undrawn page once the animation has finished. Zero means the prefetch was in time.
* **Jump latency** is from the call to the requested page having its picture, while the turn animation plays. A jump that is drawn before the animation ends costs the reader nothing.
* **Heap** is the page's JavaScript heap after a forced garbage collection. It does not include the PDF.js worker or canvas bitmaps.
* **Browser RSS** adds up every Chromium process, so it includes canvases, the worker and the browser itself (hundreds of MB). It is noisy; read changes, not the level. Linux only.
* **Cache** numbers come from `getCacheStats()`, the library's own accounting of what it holds.

### Cleanup check

It opens the long PDF by clicking a link, reads some pages, searches the whole book, then leaves by clicking another link, so React unmounts the book while the document stays alive. After each visit it checks that no PDF.js worker is running, no canvas is left, the page's nodes and event listeners are back to what they were after the first visit, and the heap is not climbing.

A Next.js page's heap climbs for the first few visits whatever it contains (the router, the JIT), so the check opens a control page with no PDF in it as well, and only counts growth beyond the control's, measured over the second half of the visits.

### Limits

* Headless Chromium paints in software. Absolute frame rates, and the cost of painting, are not those of a laptop with a GPU or a phone. Compare sizes and versions against each other.
* Nothing here covers Safari, Firefox, iOS, real touch input or a real print dialog.
* The PDFs are generated text pages. Scanned pages, large images and heavy vector art cost more per page to render, and the page cache is limited by bytes, so they hold fewer pages.

### An old Chromium

`pdfjs-dist` 6 uses `Map.prototype.getOrInsertComputed`, which Chromium before about 145 does not have. With `--polyfill=auto` the benchmark checks, and if the method is missing it adds a small shim to the page and to the PDF.js worker (it intercepts the worker request). That is for the benchmark browser only. It is not in the library, and a current browser does not need it. `--polyfill=on` and `--polyfill=off` force it either way.
