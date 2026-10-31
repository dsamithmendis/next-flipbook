"use client";

import { FlipBook, FlipBookToolbar, FlipBookToolbarButton, useFlipBook } from "next-flipbook";
import { Nav } from "../Nav";
import { imagePages } from "../data";

// Built from the same pieces as the default toolbar, with your own layout.
function MyToolbar() {
  const book = useFlipBook();
  return (
    <FlipBookToolbar>
      <FlipBookToolbarButton label="First page" icon="chevron-left" onClick={() => book.first()} disabled={!book.canGoPrevious} />
      <span aria-hidden="true">
        {book.state.currentPage} of {book.state.pageCount}
      </span>
      <FlipBookToolbarButton label="Last page" icon="chevron-right" onClick={() => book.last()} disabled={!book.canGoNext} />
      <FlipBookToolbarButton
        label={book.currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
        icon={book.currentBookmarked ? "bookmark-filled" : "bookmark"}
        pressed={book.currentBookmarked}
        onClick={() => book.toggleBookmark()}
      />
      <FlipBookToolbarButton label="Bookmarks" icon="bookmarks" onClick={() => book.togglePanel("bookmarks")}>
        {book.bookmarks.length}
      </FlipBookToolbarButton>
    </FlipBookToolbar>
  );
}

export default function CustomToolbarDemo() {
  return (
    <main>
      <h1>Your own toolbar</h1>
      <p className="lede">
        <code>renderToolbar</code> replaces the bar. It gets the same controls as{" "}
        <code>useFlipBook()</code>, and <code>FlipBookToolbarButton</code> matches the built-in look.
      </p>
      <Nav />
      <FlipBook
        pages={imagePages}
        cover
        bookmarks
        height="72vh"
        renderToolbar={() => <MyToolbar />}
      />
    </main>
  );
}
