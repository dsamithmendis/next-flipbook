# PDFs

```tsx
<FlipBook source="/magazine.pdf" pdf={{ workerSrc: "/pdf.worker.min.mjs" }} cover />
```

`source` accepts a URL string, `URL`, `File`, `Blob`, `ArrayBuffer` or `Uint8Array`. Every page of the document becomes a page of the book. To use single PDF pages inside a mixed book, use `pages={[{ type: "pdf", source, page }]}` instead.

## The worker

PDF.js parses documents in a Web Worker and needs the URL of `pdf.worker.min.mjs` from the **same pdfjs-dist version** the app uses. Pick one:

### 1. Serve it from your own origin (works with every bundler)

Copy the file into your static folder and point at it:

```bash
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
```

```tsx
<FlipBook source="/magazine.pdf" pdf={{ workerSrc: "/pdf.worker.min.mjs" }} />
```

Add the copy to a `predev` / `prebuild` script so it follows upgrades. See `demo/next-app/scripts/copy-pdf-worker.mjs`. This is the safest option for production and for strict Content-Security-Policies (`worker-src 'self'`).

### 2. Let the bundler emit it

```tsx
const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

<FlipBook source="/magazine.pdf" pdf={{ workerSrc }} />
```

| Bundler | Notes | Checked in this repo |
| --- | --- | --- |
| Next.js 16, Turbopack | Emits the worker into `.next/static/media`. The page using it must be a Client Component, because `import.meta.url` is evaluated in the browser. See `demo/next-app/app/pdf-bundled`. | Yes: production build emits the worker file |
| Next.js, Webpack | Webpack 5 treats `new URL(…, import.meta.url)` as an asset; same code. | No |
| Vite | Same code, or `import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"`. | No |
| Webpack 5 | Same code. | No |

"Checked" means a production build ran and the worker file was emitted. No browser was available, so the worker has not been seen running in one. Option 1 (a file in `public/`) is the one that does not depend on bundler behaviour.

### 3. Do nothing

Without `pdf.workerSrc`, the worker loads from `https://cdn.jsdelivr.net/npm/pdfjs-dist@<version>/build/pdf.worker.min.mjs`. This makes a first attempt work with no setup, but it is a third-party request: it fails offline and under a restrictive CSP, and the CDN becomes a runtime dependency. If you already set `pdfjs.GlobalWorkerOptions.workerSrc` yourself, it is left alone.

## Remote PDFs and CORS

PDF.js fetches remote files from the browser, so the server must allow your origin (`Access-Control-Allow-Origin`). The library never proxies requests. A blocked or offline request surfaces as a `NETWORK_ERROR` and a 404 as `PDF_NOT_FOUND`. For authenticated downloads use `pdf={{ withCredentials: true, httpHeaders: { Authorization: "…" } }}`.

A `File` from an `<input>` needs no URL at all: pass it as `source`.

## Passwords

Without `onPassword`, a built-in dialog (labelled, focus-managed, Escape to cancel) asks for the password and shows an error for a wrong one. To use your own UI:

```tsx
<FlipBook
  source={file}
  onPassword={(answer, reason) => {
    // reason is "needed" the first time and "incorrect" after a wrong attempt
    openMyDialog({ reason, onSubmit: answer, onCancel: () => answer(null) });
  }}
/>
```

`answer(null)` gives up and the viewer ends in a `PASSWORD_REQUIRED` error. `pdf={{ password }}` is tried before prompting.

## Quality and memory

| Option | Default | Effect |
| --- | --- | --- |
| `pdf.renderScale` | `"auto"` | `"auto"` renders at the on-screen width times the device pixel ratio (capped at 3), in quarter steps. A number sets pixels per PDF point. |
| `pdf.maxCanvasPixels` | 12,000,000 | One page canvas never exceeds this; larger renders are scaled down. |
| `cacheSize` | 10 | Rendered pages kept. |
| `pdf.maxCacheBytes` | 192 MB | Soft budget for all cached canvases. |
| `pdf.maxConcurrentRenders` | 2 | Pages drawn at once. |
| `pdf.maxTextCacheBytes` | 32 MB | Text kept for search. Least recently used pages are dropped and read again if needed. |
| `pdf.cleanupAfterPages` | 48 | After this many pages have been opened and the reader has gone idle, PDF.js is told to release what it keeps for every page it has opened. `0` never does. |
| `preloadPages` | 2 | Pages either side of the visible ones to prepare. |

The cache evicts the page farthest from the reader first (ties go to the least recently used) and never evicts a page on screen. Evicted canvases are shrunk to 0×0 so the browser can free their memory.

Prefetching is planned against the cache, not just against `preloadPages`. The visible pages are always drawn. Of the pages around them, only as many as fit within `cacheSize` and `pdf.maxCacheBytes` are prepared, nearest first, so a large `preloadPages` with a small `cacheSize` cannot make the viewer draw pages and throw them away before they are seen. When the reader jumps, prefetches that are no longer near are cancelled, even ones already drawing.

## Very long documents

Memory does not grow with the length of the document: it is bounded by the visible pages, `cacheSize`, `pdf.maxCacheBytes`, the thumbnail cache (160 small pictures, 40 MB) and `pdf.maxTextCacheBytes`. What does grow is what PDF.js itself keeps for every page it has opened, and the viewer asks it to release that when the reader is idle (`pdf.cleanupAfterPages`). Work is held back while it does, because PDF.js forbids drawing during a cleanup.

`getCacheStats()` on the controller shows what is held:

```tsx
const stats = ref.current?.getCacheStats();
// stats.pages       { entries, bytes, hits, misses, evictions, peakEntries, peakBytes }
// stats.thumbnails  the same, for the thumbnail list
// stats.text        { pages, bytes }: the search index
```

The `/large-pdf` demo route shows these figures live for generated PDFs of 100, 500 and 1000 pages. Measured numbers, and what they do not cover, are in [performance.md](performance.md).

PDF.js has options for how a document is fetched, which pass through `pdf.documentParams`: `disableAutoFetch` stops it downloading the rest of a file in the background, and `rangeChunkSize` sets the size of each range request. Both need a server that answers range requests. The benchmarks here read from localhost, so they say nothing about their effect.

The viewer uses the first page's aspect ratio for every page. Pages of other sizes are fitted inside it.

## Other PDF.js assets

Fonts that are not embedded in a PDF, CJK character maps and some image decoders need extra files. Host them and pass the URLs through:

```tsx
pdf={{ documentParams: { standardFontDataUrl: "/pdfjs/standard_fonts/", cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, wasmUrl: "/pdfjs/wasm/" } }}
```

The files ship in `node_modules/pdfjs-dist/` (`standard_fonts`, `cmaps`, `wasm`).

## Older browsers and custom builds

pdfjs-dist 6 targets current browsers. For older ones, load the legacy build:

```tsx
pdf={{
  loadPdfjs: () => import("pdfjs-dist/legacy/build/pdf.mjs"),
  workerSrc: "/pdf.worker.legacy.min.mjs", // copied from pdfjs-dist/legacy/build/
}}
```

`loadPdfjs` can return any module that exposes `getDocument` and `GlobalWorkerOptions`.

## Lifecycle

- A document opens when `source` (or a PDF page in `pages`) appears and closes when it goes away. Keep `source` stable between renders: a `File`, `Blob` or `ArrayBuffer` is identified by reference, so creating a new one on every render reloads the document.
- Binary sources are copied before they reach PDF.js, so your own `ArrayBuffer` is not detached. `Blob` and `File` are read directly; no object URL is created, so nothing needs revoking.
- Unmounting cancels running renders, drops cached canvases and terminates the worker. React Strict Mode's double mount is supported.
