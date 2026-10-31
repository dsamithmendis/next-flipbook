import type { FlipBookLocale } from "../types/index.js";

export const DEFAULT_LOCALE: FlipBookLocale = {
  viewerLabel: "Flipbook",
  navigationLabel: "Page navigation",
  next: "Next page",
  previous: "Previous page",
  pageIndicator: "{page} / {total}",
  pageStatus: "Page {page} of {total}",
  pagesStatus: "Pages {page} of {total}",
  pageAlt: "Page {page}",
  pageFailed: "This page could not be loaded.",
  loading: "Loading…",
  loadingProgress: "Loading document… {percent}%",
  empty: "There are no pages to show.",
  passwordTitle: "Password required",
  passwordMessage: "This document is protected. Enter the password to open it.",
  passwordIncorrect: "That password is not correct. Try again.",
  passwordLabel: "Password",
  passwordSubmit: "Open",
  passwordCancel: "Cancel",
  toolbarLabel: "Flipbook toolbar",
  zoomOut: "Zoom out",
  zoomLabel: "Zoom",
  zoomIn: "Zoom in",
  fit: "Fit to window, {percent}%",
  fullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  thumbnails: "Thumbnails",
  bookmarks: "Bookmarks",
  pagesTab: "Pages",
  closePanel: "Close panel",
  thumbnailLabel: "Go to page {page}",
  thumbnailLabelBookmarked: "Go to page {page}, bookmarked",
  addBookmark: "Bookmark this page",
  removeBookmark: "Remove bookmark",
  removeBookmarkPage: "Remove bookmark from page {page}",
  bookmarkAdded: "Bookmarked page {page}",
  bookmarkRemoved: "Removed bookmark from page {page}",
  bookmarksEmpty: "No bookmarks yet. Use the bookmark button to save a page.",
  download: "Download",
  downloadFailed: "The file could not be downloaded.",
  print: "Print",
  printPreparing: "Preparing to print… {done} of {total}",
  printFailed: "Printing failed.",
  printNothing: "There is nothing to print.",
  share: "Share",
  shareCopied: "Link copied to the clipboard.",
  shareFailed: "The link could not be shared or copied.",
  search: "Search",
  searchLabel: "Search the document",
  searchPlaceholder: "Search…",
  searchPrevious: "Previous result",
  searchNext: "Next result",
  searchCount: "{current} of {total}",
  searchNone: "No results",
  searchSearching: "Searching… {done} of {total} pages",
  searchTruncated: "Showing the first {count} results",
  outline: "Contents",
  outlineEmpty: "This document has no table of contents.",
  expandSection: "Expand {title}",
  collapseSection: "Collapse {title}",
  hotspot: "Hotspot",
  closeHotspot: "Close",
  linkOpen: "Open link: {url}",
  linkPage: "Go to page {page}",
};

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
export function formatMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

/** "3" for one page, "2–3" for a spread. */
export function formatPageRange(pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) return "0";
  return first === last ? String(first) : `${first}–${last}`;
}
