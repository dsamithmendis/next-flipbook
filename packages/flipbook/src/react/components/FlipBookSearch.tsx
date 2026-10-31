"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { useFlipBookContext } from "../context.js";
import { formatMessage } from "../locale.js";
import { FlipBookToolbarButton } from "./FlipBookToolbarButton.js";

export interface FlipBookSearchProps {
  className?: string;
  style?: CSSProperties;
  /** Typing pauses this long before a search starts, in ms. Default 250. */
  debounceMs?: number;
}

/**
 * The search box and its results. Matches are highlighted on the pages, the
 * selected one is brought into view, and Enter and Shift+Enter step through
 * them. A search starts shortly after typing stops and reads pages as it
 * goes, so results appear before a long document is finished.
 */
export function FlipBookSearch({ className, style, debounceMs = 250 }: FlipBookSearchProps) {
  const { search, locale, content, controller } = useFlipBookContext();
  const snapshot = useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot);
  const [value, setValue] = useState(snapshot.query);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  // Search a moment after typing stops.
  useEffect(() => {
    if (value === snapshot.query) return;
    const timer = setTimeout(() => void content.runSearch(value), debounceMs);
    return () => clearTimeout(timer);
    // `snapshot.query` is read to avoid repeating a search that already ran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, debounceMs]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (snapshot.query === value && snapshot.results.length > 0) {
      if (event.shiftKey) search.previous();
      else search.next();
    } else {
      void content.runSearch(value);
    }
  };

  const { results, current, status, scanned, total, truncated } = snapshot;
  let summary = "";
  if (status === "searching") summary = formatMessage(locale.searchSearching, { done: scanned, total });
  else if (results.length > 0) summary = formatMessage(locale.searchCount, { current: current + 1, total: results.length });
  else if (status === "done") summary = locale.searchNone;

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", minHeight: 0, ...style }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 2, padding: 8 }}>
        <input
          ref={input}
          type="search"
          data-flipbook-search-input=""
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={locale.searchPlaceholder}
          aria-label={locale.searchLabel}
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: "border-box",
            padding: "7px 10px",
            border: "1px solid rgba(127, 127, 127, 0.55)",
            borderRadius: 8,
            background: "transparent",
            color: "inherit",
            font: "14px system-ui, sans-serif",
          }}
        />
        <FlipBookToolbarButton
          label={locale.searchPrevious}
          icon="chevron-up"
          disabled={results.length === 0}
          onClick={() => search.previous()}
        />
        <FlipBookToolbarButton
          label={locale.searchNext}
          icon="chevron-down"
          disabled={results.length === 0}
          onClick={() => search.next()}
        />
      </div>
      <p
        role="status"
        style={{ flex: "none", margin: 0, padding: "0 12px 6px", font: "12px/1.4 system-ui, sans-serif", opacity: 0.8 }}
      >
        {summary}
        {truncated ? ` ${formatMessage(locale.searchTruncated, { count: results.length })}` : ""}
      </p>
      <ol
        style={{
          flex: 1,
          minHeight: 0,
          margin: 0,
          padding: "0 6px 8px",
          listStyle: "none",
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        {results.map((result) => (
          <li key={result.index}>
            <button
              type="button"
              data-flipbook-result={result.index}
              aria-current={result.index === current ? "true" : undefined}
              onClick={() => {
                search.goTo(result.index);
                // Choosing the selected result again must still go to its page.
                controller.goToPage(result.position);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 8px",
                border: 0,
                borderRadius: 6,
                background: result.index === current ? "rgba(127, 127, 127, 0.2)" : "transparent",
                color: "inherit",
                font: "13px/1.35 system-ui, sans-serif",
                textAlign: "start",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "block", fontWeight: 600, fontSize: 12, opacity: 0.75 }}>
                {formatMessage(locale.pageAlt, { page: result.position })}
              </span>
              <span>
                {result.before}
                <mark style={{ background: "rgba(255, 213, 0, 0.6)", color: "inherit", borderRadius: 2 }}>
                  {result.match}
                </mark>
                {result.after}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
