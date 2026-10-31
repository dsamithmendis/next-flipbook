"use client";

import { FlipBook, type FlipBookController } from "next-flipbook";
import { useRef, useState } from "react";
import { Nav } from "../Nav";

const bar = {
  display: "flex",
  flexWrap: "wrap" as const,
  alignItems: "center",
  gap: 8,
  margin: "0 0 12px",
  font: "14px system-ui, sans-serif",
};

const button = {
  padding: "6px 12px",
  border: "1px solid currentColor",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

// Zoom works on the PDF too: pages are re-rendered sharper once the zoom settles.
export default function ZoomDemo() {
  const book = useRef<FlipBookController>(null);
  const [zoom, setZoom] = useState(1);

  return (
    <main>
      <h1>Zoom and pan</h1>
      <p className="lede">
        Pinch, double-click, or hold Ctrl and scroll. Drag to pan once zoomed in; the arrow keys
        still turn pages. Keys: <code>+</code> <code>-</code> <code>0</code>. The buttons below call
        the controller you get from <code>ref</code>.
      </p>
      <Nav />
      <div style={bar}>
        <button type="button" style={button} onClick={() => book.current?.zoomOut()}>
          Zoom out
        </button>
        <button type="button" style={button} onClick={() => book.current?.zoomIn()}>
          Zoom in
        </button>
        <button type="button" style={button} onClick={() => book.current?.fit()}>
          Fit
        </button>
        <button type="button" style={button} onClick={() => book.current?.fitWidth()}>
          Fit width
        </button>
        <span aria-live="polite">Zoom {Math.round(zoom * 100)}%</span>
      </div>
      <FlipBook
        ref={book}
        source="/sample.pdf"
        pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
        cover
        minZoom={0.5}
        maxZoom={5}
        onZoomChange={setZoom}
        height="68vh"
      />
    </main>
  );
}
