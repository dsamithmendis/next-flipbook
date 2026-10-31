"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { DEFAULT_PAGE_ASPECT, type AspectRatioProp } from "../../core/layout/sizing.js";
import type { FlipBookPage } from "../../types/index.js";
import { useFlipBookContext } from "../context.js";
import { useEngineState } from "../hooks/useEngineState.js";
import { useFlipBook } from "../hooks/useFlipBook.js";
import { useLatest } from "../hooks/useLatest.js";
import { usePageAspect } from "../hooks/usePageAspect.js";
import { formatMessage } from "../locale.js";
import { BookmarkRibbon } from "./BookmarkRibbon.js";
import { ThumbnailContent } from "./Thumbnail.js";

export interface FlipBookThumbnailsProps {
  /** Same meaning as on `<FlipBook>`. Default `"auto"`. */
  aspectRatio?: AspectRatioProp;
  /** Width of one thumbnail in CSS pixels. Default 96. */
  thumbnailWidth?: number;
  /** Called after a thumbnail is chosen. */
  onSelect?: (page: number) => void;
  className?: string;
  style?: CSSProperties;
}

/** Thumbnails drawn ahead of the visible window, in pixels. */
const ROOT_MARGIN = "320px 0px";
/**
 * A thumbnail has to stay near the viewport this long before it draws its picture. A fast scroll
 * (dragging the scrollbar through a thousand pages) then draws only where it stops, not every
 * thumbnail it passes, which would also push the ones the reader is heading for out of the cache.
 */
const SETTLE_MS = 90;
/** Thumbnails reported this soon after the list appears are the first screenful and draw at once. */
const INITIAL_MS = 150;
/** Without IntersectionObserver, draw only this many so a huge book is not rendered all at once. */
const FALLBACK_COUNT = 40;

const subscribeNever = (): (() => void) => () => undefined;
const hasIntersectionObserver = (): boolean => typeof IntersectionObserver !== "undefined";

interface ThumbnailItemProps {
  number: number;
  page: FlipBookPage | undefined;
  width: number;
  height: number;
  label: string;
  isCurrent: boolean;
  isSaved: boolean;
  /** Only thumbnails near the scroll position draw their picture. */
  isNear: boolean;
  /** The one thumbnail in the Tab order. */
  isTabStop: boolean;
  onPick: (page: number) => void;
  onFocusItem: (page: number) => void;
}

/**
 * One thumbnail. Every prop is a primitive, a stable object or a stable function, so a long list
 * redraws only the few thumbnails whose state changed when the reader turns a page.
 */
const ThumbnailItem = memo(function ThumbnailItem(props: ThumbnailItemProps) {
  const { number, page, width, height, label, isCurrent, isSaved, isNear, isTabStop, onPick, onFocusItem } = props;
  return (
    <button
      type="button"
      data-thumb-page={number}
      data-flipbook-thumb={number}
      aria-current={isCurrent ? "page" : undefined}
      aria-label={label}
      tabIndex={isTabStop ? 0 : -1}
      onFocus={() => onFocusItem(number)}
      onClick={() => onPick(number)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: 0,
        border: 0,
        background: "transparent",
        color: "inherit",
        font: "12px/1 system-ui, sans-serif",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "relative",
          display: "block",
          width,
          height,
          overflow: "hidden",
          background: "var(--flipbook-page-background, #ffffff)",
          borderRadius: 2,
          boxShadow: isCurrent
            ? "0 0 0 2px var(--flipbook-accent, #2563eb)"
            : "0 0 0 1px rgba(127, 127, 127, 0.4)",
        }}
      >
        {isNear ? <ThumbnailContent page={page} pageNumber={number} width={width} /> : null}
        {isSaved ? <BookmarkRibbon side="right" size={0.7} /> : null}
      </span>
      <span style={{ fontWeight: isCurrent ? 700 : 400 }}>{number}</span>
    </button>
  );
});

/**
 * A scrolling list of page thumbnails. Only the ones near the scroll
 * position draw their picture, the current pages are highlighted and kept in
 * view, and bookmarked pages carry a ribbon. Arrow keys, Home and End move
 * between thumbnails (one tab stop, like a list box); Enter or Space opens one.
 */
export function FlipBookThumbnails(props: FlipBookThumbnailsProps) {
  const { aspectRatio = "auto", thumbnailWidth = 96, onSelect, className, style } = props;
  const { pages, imageLoader, pdf, engine, locale, controller, interaction } = useFlipBookContext();
  const book = useFlipBook();
  const state = useEngineState(engine);
  const { aspect } = usePageAspect(pages, aspectRatio, imageLoader, pdf);
  const height = Math.round(thumbnailWidth / (aspect ?? DEFAULT_PAGE_ASPECT));

  const saved = useMemo(() => new Set(book.bookmarks), [book.bookmarks]);
  const scroller = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set());
  const total = pages.length;
  const currentPage = state.currentPage;

  // The tab stop is the page being read until the reader moves through the list with the keys,
  // and follows the book again when it turns.
  const [focus, setFocus] = useState({ from: currentPage, page: currentPage });
  const focusPage = focus.from === currentPage ? focus.page : currentPage;

  // Without IntersectionObserver (or while rendering on the server, which draws nothing) only the
  // first few thumbnails draw, so a huge book is not rendered all at once.
  const observable = useSyncExternalStore(subscribeNever, hasIntersectionObserver, () => true);
  const fallbackNear = useMemo<ReadonlySet<number>>(
    () => new Set(Array.from({ length: Math.min(total, FALLBACK_COUNT) }, (_, i) => i + 1)),
    [total],
  );
  const drawn = observable ? near : fallbackNear;

  // Draw only what is near the viewport, and only once it has stayed there for a moment.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !observable) return;
    const created = performance.now();
    let waiting = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const admit = (): void => {
      timer = null;
      const ready = waiting;
      waiting = new Set();
      if (ready.size === 0) return;
      setNear((previous) => {
        const next = new Set(previous);
        for (const page of ready) next.add(page);
        return next;
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const left: number[] = [];
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.thumbPage);
          if (entry.isIntersecting) waiting.add(page);
          else {
            waiting.delete(page);
            left.push(page);
          }
        }
        if (left.length > 0) {
          setNear((previous) => {
            if (!left.some((page) => previous.has(page))) return previous;
            const next = new Set(previous);
            for (const page of left) next.delete(page);
            return next;
          });
        }
        if (waiting.size === 0) return;
        if (performance.now() - created < INITIAL_MS) {
          if (timer !== null) clearTimeout(timer);
          admit();
        } else if (timer === null) {
          timer = setTimeout(admit, SETTLE_MS);
        }
      },
      { root, rootMargin: ROOT_MARGIN },
    );
    for (const element of root.querySelectorAll("[data-thumb-page]")) observer.observe(element);
    return () => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
    };
  }, [observable, total, thumbnailWidth, height]);

  // Keep the page you are reading in view, and make it the tab stop. A short move glides; opening
  // the panel, or following a jump across hundreds of pages, goes straight there, because gliding
  // would drag every thumbnail on the way past the viewport.
  const arrived = useRef(false);
  useEffect(() => {
    if (currentPage < 1) return;
    const root = scroller.current;
    const element = root?.querySelector(`[data-thumb-page="${currentPage}"]`) as HTMLElement | null;
    if (!root || !element) return;
    const away = Math.abs(element.getBoundingClientRect().top - root.getBoundingClientRect().top);
    const glide = arrived.current && !interaction.reducedMotion && away < root.clientHeight * 2;
    arrived.current = true;
    element.scrollIntoView?.({ block: "nearest", behavior: glide ? "smooth" : "auto" });
  }, [currentPage, interaction.reducedMotion]);

  const onSelectRef = useLatest(onSelect);
  const pick = useCallback(
    (page: number): void => {
      controller.goToPage(page);
      onSelectRef.current?.(page);
    },
    [controller, onSelectRef],
  );

  // Stable, so that turning the page does not redraw every thumbnail.
  const currentRef = useLatest(currentPage);
  const moveFocus = useCallback(
    (page: number): void => setFocus({ from: currentRef.current, page }),
    [currentRef],
  );

  const focusItem = (page: number): void => {
    const target = Math.min(total, Math.max(1, page));
    moveFocus(target);
    (scroller.current?.querySelector(`[data-flipbook-thumb="${target}"]`) as HTMLElement | null)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const page = focusPage;
    let target: number | null = null;
    if (event.key === "ArrowDown") target = page + 1;
    else if (event.key === "ArrowUp") target = page - 1;
    else if (event.key === "PageDown") target = page + 5;
    else if (event.key === "PageUp") target = page - 5;
    else if (event.key === "Home") target = 1;
    else if (event.key === "End") target = total;
    if (target === null) return;
    // These keys move through the list; they must not also turn the book.
    event.preventDefault();
    event.stopPropagation();
    focusItem(target);
  };

  const visible = new Set(state.visiblePages);

  return (
    <nav aria-label={locale.thumbnails} className={className} style={{ minHeight: 0, ...style }}>
      <div
        ref={scroller}
        onKeyDown={onKeyDown}
        style={{
          height: "100%",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: 8,
          boxSizing: "border-box",
          display: "grid",
          // The first page sits on the right in a right-to-left book, as in the book itself.
          direction: state.direction === "rtl" ? "rtl" : "ltr",
          gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailWidth}px, 1fr))`,
          justifyItems: "center",
          alignContent: "start",
          gap: 12,
        }}
      >
        {Array.from({ length: total }, (_, index) => {
          const number = index + 1;
          const isSaved = saved.has(number);
          return (
            <ThumbnailItem
              key={number}
              number={number}
              page={pages[index]}
              width={thumbnailWidth}
              height={height}
              label={formatMessage(isSaved ? locale.thumbnailLabelBookmarked : locale.thumbnailLabel, {
                page: number,
              })}
              isCurrent={visible.has(number)}
              isSaved={isSaved}
              isNear={drawn.has(number)}
              isTabStop={number === focusPage}
              onPick={pick}
              onFocusItem={moveFocus}
            />
          );
        })}
      </div>
    </nav>
  );
}
