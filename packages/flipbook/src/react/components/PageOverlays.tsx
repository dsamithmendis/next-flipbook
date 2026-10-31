"use client";

import {
  cloneElement,
  isValidElement,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Highlight } from "../../core/search/SearchController.js";
import type { FlipBookHotspot } from "../../types/index.js";
import { useFlipBookContext } from "../context.js";

const percent = (value: number): string => `${value * 100}%`;

/** A single element you pass as an overlay is made clickable; anything else is left as given. */
function clickable(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ style?: CSSProperties }>;
  return cloneElement(element, { style: { pointerEvents: "auto", ...element.props.style } });
}

/**
 * Everything drawn on top of a page's own content: search highlights, your
 * overlay, and hotspots. All of it sits in a layer that lets pointer events
 * through, so dragging and zooming still work over it.
 */
export function PageOverlays({
  pageNumber,
  highlights,
}: {
  pageNumber: number;
  highlights: readonly Highlight[] | undefined;
}) {
  const { content, ui, locale } = useFlipBookContext();
  const activeHotspot = useSyncExternalStore(
    ui.subscribe,
    () => ui.getSnapshot().hotspot,
    () => null,
  );
  const hotspots = content.hotspotsByPage.get(pageNumber);
  const overlay = content.overlays[pageNumber];
  if (!highlights?.length && !hotspots?.length && overlay === undefined) return null;

  return (
    <div data-flipbook-overlays="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {highlights?.map((highlight, index) => (
        <span
          key={index}
          data-flipbook-highlight={highlight.current ? "current" : ""}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: percent(highlight.rect.x),
            top: percent(highlight.rect.y),
            width: percent(highlight.rect.width),
            height: percent(highlight.rect.height),
            // Plain alpha rather than a blend mode, so a highlight is visible on dark pages too;
            // the selected one also gets an outline.
            background: highlight.current ? "rgba(255, 140, 0, 0.45)" : "rgba(255, 213, 0, 0.4)",
            outline: highlight.current ? "2px solid rgba(230, 100, 0, 0.95)" : undefined,
            borderRadius: 2,
          }}
        />
      ))}

      {overlay !== undefined && overlay !== null && overlay !== false ? (
        <div data-flipbook-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {clickable(overlay)}
        </div>
      ) : null}

      {hotspots?.map((hotspot) => (
        <HotspotTarget
          key={hotspot.id}
          hotspot={hotspot}
          open={activeHotspot === hotspot.id}
          label={hotspot.label ?? locale.hotspot}
          toggle={() => ui.setHotspot(activeHotspot === hotspot.id ? null : hotspot.id)}
        />
      ))}
    </div>
  );
}

function HotspotTarget({
  hotspot,
  open,
  label,
  toggle,
}: {
  hotspot: FlipBookHotspot;
  open: boolean;
  label: string;
  toggle: () => void;
}) {
  const style: CSSProperties = {
    position: "absolute",
    left: percent(hotspot.x),
    top: percent(hotspot.y),
    width: percent(hotspot.width),
    height: percent(hotspot.height),
    pointerEvents: "auto",
    display: "block",
    padding: 0,
    margin: 0,
    border: 0,
    background: "transparent",
    cursor: "pointer",
    borderRadius: 3,
  };

  if (hotspot.href !== undefined) {
    return (
      <a
        href={hotspot.href}
        data-flipbook-hotspot={hotspot.id}
        aria-label={label}
        rel="noopener noreferrer"
        onClick={() => hotspot.onClick?.(hotspot)}
        style={style}
      />
    );
  }
  return (
    <button
      type="button"
      data-flipbook-hotspot={hotspot.id}
      aria-label={label}
      aria-haspopup={hotspot.content === undefined ? undefined : "dialog"}
      aria-expanded={hotspot.content === undefined ? undefined : open}
      onClick={() => {
        hotspot.onClick?.(hotspot);
        if (hotspot.content !== undefined) toggle();
      }}
      style={style}
    />
  );
}
