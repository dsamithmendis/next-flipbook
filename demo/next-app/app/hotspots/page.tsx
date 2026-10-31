"use client";

import { FlipBook, type FlipBookHotspot } from "next-flipbook";
import { useMemo, useState } from "react";
import { Nav } from "../Nav";
import { imagePages } from "../data";

// Coordinates are fractions of the page, so they stay put at any size or zoom.
// These sit on the circles and the title that are drawn into the page images.
export default function HotspotsDemo() {
  const [last, setLast] = useState("Nothing pressed yet.");

  const hotspots = useMemo<FlipBookHotspot[]>(
    () => [
      {
        id: "morning-sun",
        page: 3,
        x: 0.48,
        y: 0.26,
        width: 0.3,
        height: 0.23,
        label: "About the morning light",
        content: (
          <p style={{ margin: 0 }}>
            Shot at 6:10, an hour after the first train left the platform. The popover can hold any
            React you like.
          </p>
        ),
        onClick: (hotspot) => setLast(`Pressed ${hotspot.id}`),
      },
      {
        id: "harbour",
        page: 4,
        x: 0.22,
        y: 0.26,
        width: 0.3,
        height: 0.23,
        label: "About the harbour",
        content: (
          <p style={{ margin: 0 }}>
            The popover sits next to the hotspot, stays inside the book, and closes with Escape, its
            button, or a press anywhere else.
          </p>
        ),
      },
      {
        id: "slow-trains",
        page: 5,
        x: 0.18,
        y: 0.45,
        width: 0.62,
        height: 0.07,
        label: "Read more about slow trains",
        href: "https://example.com/slow-trains",
        onClick: (hotspot) => setLast(`Followed ${hotspot.id}`),
      },
    ],
    [],
  );

  return (
    <main>
      <h1>Hotspots and overlays</h1>
      <p className="lede">
        Press the large circle on page 3 or 4 for a popover, or the title on page 5 for a link.
        The button on the cover is an overlay: your own React, drawn on top of a page.
      </p>
      <Nav />
      <p aria-live="polite" style={{ font: "14px system-ui, sans-serif", margin: "0 0 12px" }}>
        {last}
      </p>
      <FlipBook
        pages={imagePages}
        cover
        hotspots={hotspots}
        overlays={{
          1: (
            <button
              type="button"
              onClick={() => setLast("Pressed the cover button")}
              style={{
                position: "absolute",
                left: "50%",
                bottom: "8%",
                transform: "translateX(-50%)",
                padding: "8px 18px",
                border: "1px solid currentColor",
                borderRadius: 999,
                background: "rgba(255, 255, 255, 0.12)",
                color: "#fff",
                font: "14px system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              Start reading
            </button>
          ),
        }}
        height="72vh"
      />
    </main>
  );
}
