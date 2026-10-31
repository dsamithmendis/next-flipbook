"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { FlipBookOutlineItem } from "../../core/types.js";
import { useFlipBookContext } from "../context.js";
import { useEngineState } from "../hooks/useEngineState.js";
import { formatMessage } from "../locale.js";
import { FlipBookIcon } from "../icons.js";

export interface FlipBookTOCProps {
  className?: string;
  style?: CSSProperties;
  onSelect?: (page: number) => void;
}

interface Flat {
  key: string;
  item: FlipBookOutlineItem;
}

function flatten(items: readonly FlipBookOutlineItem[], prefix = ""): Flat[] {
  const out: Flat[] = [];
  items.forEach((item, index) => {
    const key = prefix ? `${prefix}.${index}` : `${index}`;
    out.push({ key, item }, ...flatten(item.items, key));
  });
  return out;
}

const NO_ITEMS: readonly FlipBookOutlineItem[] = [];

/** "0.2.1" is inside "0.2" and "0". */
function ancestors(key: string): string[] {
  const parts = key.split(".");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("."));
}

/**
 * The PDF's own table of contents, with nested sections that open and close.
 * The section being read is marked and kept open.
 */
export function FlipBookTOC({ className, style, onSelect }: FlipBookTOCProps) {
  const { content, locale, controller, engine } = useFlipBookContext();
  const state = useEngineState(engine);
  const items = content.outline ?? NO_ITEMS;
  const flat = useMemo(() => flatten(items), [items]);

  // The last entry, in reading order, that starts on or before the last page on screen, so a
  // section that begins on the right-hand page of a spread is already the one being read.
  const lastVisible = state.visiblePages.length > 0 ? Math.max(...state.visiblePages) : state.currentPage;
  const reached = useMemo(() => {
    let found: string | null = null;
    for (const { key, item } of flat) if (item.page !== null && item.page <= lastVisible) found = key;
    return found;
  }, [flat, lastVisible]);

  // A spread shows two pages, so several entries can start on it. The one the
  // reader chose stays marked for as long as its page is on screen.
  const [picked, setPicked] = useState<string | null>(null);
  const active = useMemo(() => {
    const choice = picked === null ? undefined : flat.find((entry) => entry.key === picked);
    if (choice?.item.page != null && state.visiblePages.includes(choice.item.page)) return choice.key;
    return reached;
  }, [picked, flat, reached, state.visiblePages]);

  // When the section being read changes, its parents open. The reader can close them again, and
  // they stay closed until the reading moves to another section.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(active ? ancestors(active) : []));
  const [openedFor, setOpenedFor] = useState(active);
  if (openedFor !== active) {
    setOpenedFor(active);
    const missing = active ? ancestors(active).filter((key) => !expanded.has(key)) : [];
    if (missing.length > 0) setExpanded(new Set([...expanded, ...missing]));
  }

  const toggle = (key: string): void =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (items.length === 0) {
    return (
      <p style={{ margin: 0, padding: 16, font: "13px/1.5 system-ui, sans-serif", opacity: 0.75 }}>
        {locale.outlineEmpty}
      </p>
    );
  }

  const renderLevel = (level: readonly FlipBookOutlineItem[], prefix: string, depth: number) => (
    <ul style={{ listStyle: "none", margin: 0, padding: depth === 0 ? 8 : "0 0 0 14px" }}>
      {level.map((item, index) => {
        const key = prefix ? `${prefix}.${index}` : `${index}`;
        const open = expanded.has(key);
        const hasChildren = item.items.length > 0;
        const current = key === active;
        const label = (
          <>
            <span style={{ fontWeight: item.bold || current ? 600 : 400, fontStyle: item.italic ? "italic" : "normal" }}>
              {item.title}
            </span>
            {item.page !== null ? <span style={{ opacity: 0.6, flex: "none" }}>{item.page}</span> : null}
          </>
        );
        const rowStyle: CSSProperties = {
          flex: 1,
          minWidth: 0,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          padding: "5px 6px",
          border: 0,
          borderRadius: 6,
          background: current ? "rgba(127, 127, 127, 0.2)" : "transparent",
          color: "inherit",
          font: "13px/1.35 system-ui, sans-serif",
          textAlign: "start",
          textDecoration: "none",
        };
        return (
          <li key={key}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
              {hasChildren ? (
                <button
                  type="button"
                  data-flipbook-button=""
                  aria-expanded={open}
                  aria-label={formatMessage(open ? locale.collapseSection : locale.expandSection, { title: item.title })}
                  onClick={() => toggle(key)}
                  style={{
                    flex: "none",
                    width: 26,
                    height: 26,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: 0,
                    borderRadius: 6,
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    transform: open ? "rotate(90deg)" : undefined,
                  }}
                >
                  <FlipBookIcon name="chevron-right" size={14} />
                </button>
              ) : (
                <span style={{ flex: "none", width: 26 }} />
              )}
              {item.page !== null ? (
                <button
                  type="button"
                  data-flipbook-toc={key}
                  aria-current={current ? "location" : undefined}
                  onClick={() => {
                    setPicked(key);
                    controller.goToPage(item.page as number);
                    onSelect?.(item.page as number);
                  }}
                  style={{ ...rowStyle, cursor: "pointer" }}
                >
                  {label}
                </button>
              ) : item.url !== null ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" data-flipbook-toc={key} style={{ ...rowStyle, cursor: "pointer" }}>
                  {label}
                </a>
              ) : (
                <span data-flipbook-toc={key} style={rowStyle}>
                  {label}
                </span>
              )}
            </div>
            {hasChildren && open ? renderLevel(item.items, key, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-label={locale.outline} className={className} style={{ minHeight: 0, overflowY: "auto", ...style }}>
      {renderLevel(items, "", 0)}
    </nav>
  );
}
