# Toolbar, thumbnails, bookmarks and actions

```tsx
<FlipBook
  source="/magazine.pdf"
  thumbnails            // a thumbnail panel
  bookmarks             // bookmark pages
  fullscreen            // on by default
  download print share  // each opt-in
/>
```

Every optional feature is off until you switch it on, so a plain `<FlipBook>` stays small and quiet. The toolbar sits at the bottom: previous, page counter and next; zoom out, the zoom percentage (click it to fit) and zoom in; then the buttons for whichever features you enabled.

| Prop | Default | |
| --- | --- | --- |
| `toolbar` | `true` | `false` removes the bar (keyboard and gestures still work) |
| `navigation` | `true` | previous / next / counter |
| `zoom` | `true` | zoom buttons, plus gestures and keys |
| `fullscreen` | `true` | button and `F` key |
| `thumbnails` | `false` | thumbnail panel |
| `bookmarks` | `false` | bookmark button, ribbons, list, `B` key |
| `download`, `print`, `share` | `false` | see below |
| `renderToolbar` | none | replaces the bar |

## Bookmarks

Bookmarks are the **reader's own marks**: save a page, see it later. (The bookmarks *inside* a PDF file, its outline or table of contents, are a different thing: see the `outline` prop in [search-and-links.md](search-and-links.md#contents).)

- A toolbar button (and the `B` key) bookmarks the page on screen. On a two-page spread it bookmarks the first page, and if either page is already bookmarked it removes the bookmark instead, so the button always reflects what you see.
- A ribbon hangs from the top corner of a bookmarked page, and from its thumbnail.
- A second toolbar button opens the **bookmark list**: each entry has a thumbnail, a button to jump to it and a button to remove it.
- A short notice ("Bookmarked page 12") is shown and announced to screen readers.

```tsx
<FlipBook
  source={url}
  bookmarks={{
    persist: true,                         // remember between visits
    onChange: (pages) => save(pages),      // the reader added or removed one
  }}
/>
```

| Option | |
| --- | --- |
| `value` | Keeps the list in step with your own state. A new `value` replaces the list and is **not** reported through `onChange`. Reader changes are reported but are not undone if you ignore them, so update `value` in `onChange` |
| `defaultValue` | Starting bookmarks |
| `onChange(pages)` | Called when the reader adds or removes a bookmark |
| `persist` | `true` keys storage by the PDF URL in `source`. Pass a string to choose the key; that is required for `pages` books and for non-URL sources. Keys are prefixed with `next-flipbook:bookmarks:` |
| `storage` | Any object with `getItem` and `setItem`. Default `localStorage` |

Saved state is loaded after the page has hydrated, so server and client markup always match. A controlled `value` wins over what was saved. Bookmarks written in another tab appear here too. Storage that is full or blocked (private modes, sandboxed frames) never throws: bookmarks simply last for the visit. Bookmarks beyond the end of a book are ignored without being erased from storage, so a PDF that is still loading never wipes the reader's marks.

From code: `ref.current.addBookmark(page?)`, `removeBookmark`, `toggleBookmark`, `isBookmarked`, `getBookmarks()`, `clearBookmarks()`. Without a page they act on the page on screen. They do nothing unless `bookmarks` is on.

## Thumbnails

A panel opened from the toolbar (`defaultThumbnailsOpen` starts it open). On wide containers it is a sidebar; below `breakpoint` (640 px by default) it is a **bottom sheet** that closes after you choose a page. When bookmarks are also on, the panel has **Pages** and **Bookmarks** tabs.

- Only thumbnails near the scroll position draw their picture (IntersectionObserver). A thumbnail that scrolls away before its turn is never rendered.
- The pages on screen are outlined and kept in view as you read.
- Image pages show the full image scaled down, or `thumbnail: "/small/3.jpg"` if you provide one. PDF pages are rendered small into their own cache (160 entries, 40 MB), apart from the pages you read, so a long thumbnail list never pushes real pages out. React pages show their page number.
- Keyboard: one tab stop. Up and Down move between thumbnails, Page Up and Page Down jump five, Home and End go to the ends, Enter or Space opens one, Escape closes the panel. These keys do not also turn the book.

## Fullscreen

The button and `F` use the browser's Fullscreen API. Where it is missing or refused (iPhone Safari, a frame without `allow="fullscreen"`), the viewer **fills the window** instead, locks page scroll while it does, and Escape leaves. `onFullscreenChange(isFullscreen)` fires for both. The `width` and `height` props are ignored while fullscreen.

## Download, print and share

**Download** needs something to download: a PDF `source`, or `download={{ url }}` (for an image book, say). A same-origin file downloads directly. A cross-origin URL cannot be forced to download by any website, so it opens in a new tab rather than navigating away. A `File`, `Blob`, `ArrayBuffer` or `Uint8Array` is saved from memory through an object URL that is revoked afterwards (and immediately on unmount). `filename` overrides the name.

**Print** prints the pages, not the viewer: the pages are laid out one per sheet in a hidden frame, with no margins. Image pages are printed from their URLs. PDF pages are rendered one at a time at `print.scale` (default 2, about 144 dpi), turned into a JPEG, and their canvas is released before the next page starts, so memory stays flat on a long document. A notice shows progress ("Preparing to print… 12 of 40"), and unmounting cancels the job. React pages cannot be printed and are skipped; a book of only React pages shows no print button. A page that fails to render is skipped; if nothing can be printed the reader is told. Printing needs the browser's print dialog, so it has only been tested with that dialog replaced.

**Share** opens the system share sheet where there is one (phones, some desktops) and otherwise copies the link and says so. The reader closing the share sheet is not an error and shows nothing. Defaults are the current address and the page title; override with `share={{ url, title, text }}`, or take over entirely with `onShare(data)`.

Calling `ref.current.download()`, `print()` or `share()` returns a promise that never rejects, and does nothing unless the matching prop is on.

## A toolbar of your own

`renderToolbar` replaces the bar. It receives `{ controls }`, the same object `useFlipBook()` returns: navigation, zoom, fullscreen, bookmark, panel and action methods, plus live state (`state`, `zoomState`, `ui`, `bookmarks`, `currentBookmarked`, `features`, `locale`).

```tsx
<FlipBook
  pages={pages}
  bookmarks
  renderToolbar={({ controls }) => (
    <FlipBookToolbar>
      <FlipBookToolbarButton label="Next" icon="chevron-right" onClick={controls.next} />
      <FlipBookToolbarButton
        label="Bookmark"
        icon={controls.currentBookmarked ? "bookmark-filled" : "bookmark"}
        pressed={controls.currentBookmarked}
        onClick={() => controls.toggleBookmark()}
      />
    </FlipBookToolbar>
  )}
/>
```

`FlipBookToolbar` is the bar; give it `children` to lay out your own buttons in it. `FlipBookToolbarButton` matches the built-in buttons (`icon` is one of `chevron-left`, `chevron-right`, `minus`, `plus`, `fit`, `expand`, `shrink`, `bookmark`, `bookmark-filled`, `bookmarks`, `grid`, `download`, `print`, `share`, `close`). For a fully headless layout, `FlipBookThumbnails`, `FlipBookBookmarks` and `FlipBookSidePanel` can be placed anywhere inside a `FlipBookProvider`. See `demo/next-app/app/custom-toolbar`.

## Translating

Every string, including the notices and the panel, comes from `locale`. Placeholders: `{page}`, `{total}`, `{done}`, `{percent}`.

## Accessibility

The bar is a labelled group of real buttons. Toggles use `aria-pressed`; the print button is `aria-busy` and disabled while working; buttons that grey out use `aria-disabled` so keyboard focus is not lost. The panel is a labelled `nav` with tabs (`role="tablist"`), and the current thumbnails carry `aria-current="page"`. Notices are `role="status"` and re-announced when the same text repeats.
