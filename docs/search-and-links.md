# Search, contents, links, hotspots and saved place

```tsx
<FlipBook
  source="/guide.pdf"
  search                 // text search: the / key, a panel, highlights on the page
  outline                // the PDF's own table of contents
  urlState               // ?page=5 in the address bar
  persistState           // remember where the reader stopped
/>
```

All of these are off (or, for `links`, on) exactly as listed in the table below, so a plain `<FlipBook>` stays small. Nothing here runs on the server: search, links and saved state are set up after the page has hydrated, so server and client markup always match.

| Prop | Default | |
| --- | --- | --- |
| `search` | `false` | `true` or `{ minLength, maxResults }`. Search panel, `/` key, highlights |
| `onSearch`, `onSearchResult` | none | A query was run; a search finished (`{ query, count, truncated }`) |
| `outline` | `false` | Contents panel from the PDF's own bookmarks. Shown only if the PDF has some |
| `links` | `true` | Make the links inside PDF pages clickable |
| `onLinkClick` | none | See a link before it is followed; return `false` to stop it |
| `hotspots` | none | Regions of pages that open a popover, call you back or link somewhere |
| `overlays` | none | Your own React drawn over a page, by page number |
| `urlState` | `false` | `true` or `{ param, hash, history }` |
| `persistState` | `false` | `true`, a key, or `{ key, storage, zoom }` |

## Search

Pressing `/` (or the toolbar button) opens a panel with a focused search box. Type at least two characters and the book searches the PDF page by page, and results appear as soon as they are found:

- The status line shows `3 of 12 results`, or how many pages have been read while the search is still running, or "no results".
- The first result **at or after the page you are on** is selected, and the book turns to it. `Enter` and `Shift+Enter` (or the arrow buttons) step through the results, turning the book as they go. Choosing a result from the list always goes to its page, even if it is already selected.
- Every match is highlighted on its page; the selected one is a different colour. Highlights are positioned as fractions of the page, so they stay put at any size and any zoom.
- Matching ignores case, and any run of whitespace in the query matches any run of whitespace in the text. Characters such as `.` or `(` are matched literally, not as a pattern.
- Typing again cancels the search in progress and starts a new one. Closing the panel (or `Escape`) cancels it and removes the highlights.
- A search stops at `maxResults` (500 by default) and says so, so a one-letter query cannot freeze the page.

```tsx
<FlipBook source={url} search={{ minLength: 3, maxResults: 200 }} onSearchResult={(info) => track(info)} />
```

From code (these do nothing unless `search` is on): `ref.current.search("train")` opens the panel and runs the query, `nextSearchResult()`, `previousSearchResult()`, `clearSearch()` and `getSearchResults()`.

**What it searches.** Only PDF pages, and only the text that PDF.js can extract. Image pages and custom React pages have no text and are skipped; a scanned PDF with no text layer finds nothing (that needs OCR, which is not built in). The `search` feature is switched on only when the book has at least one PDF page. Words that a PDF breaks across lines with a hyphen are two words to the search.

**Why there is a search of its own.** PDF pages are drawn to a canvas, so there is no selectable text on them and the browser's find-in-page cannot see inside. A selectable text layer is not built; the built-in search covers the common reason for wanting one.

Highlight positions inside a line are worked out from character counts, so with a proportional font a highlight can be slightly off at the edges of the word. It always covers the right line.

## Contents

```tsx
<FlipBook source={url} outline />
```

Opens a **Contents** tab built from the bookmarks stored in the PDF (what a desktop PDF reader calls its outline). They are the document's own table of contents, and not the reader's [bookmarks](toolbar.md#bookmarks).

- Sections nest and can be opened and closed. The entry for the section you are reading is marked, and its parents are kept open while you read.
- An entry goes to a page of the **book**. When the PDF is only part of a book (`pages` with several PDF pages), entries are mapped onto the right book page, and entries that point at a page that is not in the book are shown as plain text.
- An entry that links to the web is a real link, and only `http`, `https`, `mailto` and `tel` addresses are followed.
- The tab is offered only if the PDF has contents. At most 2,000 entries are read.

`await ref.current.getOutline()` returns the same tree: `{ title, page, url, bold, italic, items }`, where `page` is a 1-based book page or `null`.

## Links in the PDF

Link annotations in a PDF page become real `<a>` elements over the page (`links`, on by default; `links={false}` turns them off).

- **Internal links** (to a page, or to a named destination) turn the book to that page.
- **Web links** open in a new tab with `rel="noopener noreferrer"`. Only `http`, `https`, `mailto` and `tel` are followed; `javascript:`, `data:`, `file:` and relative addresses are dropped, so a PDF cannot run script in your page.
- A link to a page that is not in the book is not drawn.
- A drag never starts on a link, and the click that ends a drag does not follow one.

```tsx
<FlipBook
  source={url}
  onLinkClick={(link) => {
    // { type: "page", page: 5 } or { type: "url", url: "https://..." }
    if (link.type === "url") return confirm(`Leave this page for ${link.url}?`); // false stops it
  }}
/>
```

## Hotspots

A hotspot is a region of a page the reader can activate. Coordinates are **fractions of the page** (0 to 1, from the top left), so they hold at every size, zoom and resolution.

```tsx
<FlipBook
  pages={pages}
  hotspots={[
    { id: "map", page: 3, x: 0.1, y: 0.2, width: 0.4, height: 0.25,
      label: "About the map", content: <p>Drawn in 1921.</p> },        // opens a popover
    { id: "shop", page: 5, x: 0.1, y: 0.8, width: 0.5, height: 0.08,
      label: "Buy the book", href: "https://example.com/shop" },        // a link
    { id: "log", page: 6, x: 0.6, y: 0.1, width: 0.3, height: 0.3,
      label: "Play", onClick: (spot) => play(spot.id) },                // a callback
  ]}
/>
```

- A hotspot with `content` is a button that opens a popover next to it. The popover takes focus, has a close button, and closes with `Escape` (before anything else does), with its button, when the reader presses elsewhere, or when its page turns away. Only one is open at a time. Closing it with its button puts focus back on the hotspot.
- A hotspot with `href` is a link. Its address is yours, so it is **not** filtered the way a PDF's links are: do not put text from your users in it.
- `label` is the accessible name and the popover title. Hotspots are invisible; draw a marker under them (it is part of your page image) or with an overlay.
- Hotspots work on every kind of page. Functions (`onClick`) make `hotspots` a prop of a Client Component; plain `content` and `href` can be passed from a Server Component.

## Overlays

```tsx
<FlipBook pages={pages} overlays={{ 1: <button onClick={start}>Start reading</button> }} />
```

Whatever you give for a page number is drawn over that page, inside a layer that fills the page. The layer lets pointer events through, so dragging, zooming and hotspots still work around your content. A single element is made clickable for you (`pointer-events: auto`); for several elements, wrap them in one and set `pointerEvents: "auto"` on the parts that should respond. Position things with `position: absolute` and percentages.

## Deep links

```tsx
<FlipBook source={url} urlState />                          // ?page=5
<FlipBook source={url} urlState={{ hash: true }} />         // #page=5
<FlipBook source={url} urlState={{ param: "p", history: "push" }} />
```

The address follows the page, and the book opens at the page in the address.

- Only whole page numbers are accepted; anything else is ignored, and a number past the end is clamped to the last page.
- `history: "replace"` (the default) keeps one history entry however many pages are turned. `"push"` adds one per turn, and the back and forward buttons then move the book. Other parts of the address (other parameters, the hash) are left alone.
- The book also follows `popstate` and `hashchange`, so a link a reader pastes into the same tab works. Navigation through `next/link` does not fire those events: use a normal link, or call `ref.current.goToPage()`.
- For a PDF, the page is applied once the document has loaded.

## Saved place

```tsx
<FlipBook source="/catalog.pdf" persistState />                           // keyed by the URL
<FlipBook pages={pages} persistState="spring-catalog" />                  // keyed by a name you choose
<FlipBook pages={pages} persistState={{ key: "spring", storage: sessionStorage, zoom: false }} />
```

The page (and, unless `zoom: false`, a zoom above fitted size) is saved a moment after the reader stops turning, and when the book is closed. On the next visit the book opens there.

- **Order of precedence:** the page in the address, then the saved place, then `initialPage`.
- Zoom is only restored when it was above fitted size, so a reader never comes back to a book zoomed out into a corner.
- `persistState` (as `true`) needs a PDF URL in `source` to key by. For anything else give a key; without one the book reports `INVALID_ARGUMENT` through `onError` and carries on without saving.
- Keys are prefixed with `next-flipbook:state:`. The default storage is `localStorage`; give any object with `getItem` and `setItem` to change that.
- Saved state is read after hydration. Damaged data is ignored, and storage that is full or blocked never throws: the place is simply not remembered.

## Not built

- OCR for scanned PDFs, and a selectable text layer.
- Searching across several books, or searching text in image and custom pages.
- Regular expressions, whole-word and case-sensitive options in the search box. (The core `compileQuery` and `findMatches` helpers are exported from `next-flipbook/core` for anyone who wants to build their own.)
- Highlighting by the reader, and annotations.
