// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlipBook } from "../src/index.js";

describe("server rendering", () => {
  it("runs in an environment with no window or document", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders the viewer shell without touching browser globals", () => {
    const html = renderToString(<FlipBook pages={["/1.jpg", "/2.jpg", "/3.jpg"]} cover />);
    expect(html).toContain('role="region"');
    expect(html).toContain("Loading");
    // Pages are only drawn after the browser measures the container.
    expect(html).not.toContain("<img");
  });

  it("renders the empty state for a book with no pages", () => {
    const html = renderToString(<FlipBook pages={[]} />);
    expect(html).toContain("There are no pages to show.");
  });

  it("renders a PDF viewer shell on the server without loading pdf.js", () => {
    const html = renderToString(<FlipBook source="/magazine.pdf" cover />);
    expect(html).toContain('role="region"');
    expect(html).toContain("Loading");
    expect(html).not.toContain("<canvas");
  });

  it("renders every PDF option without touching the browser", () => {
    const html = renderToString(
      <FlipBook
        source="/magazine.pdf"
        pdf={{ workerSrc: "/pdf.worker.min.mjs", renderScale: 2, password: "x" }}
        onPassword={() => undefined}
        cacheSize={4}
      />,
    );
    expect(html).toContain('role="region"');
  });

  it("renders the toolbar and every optional feature on the server without touching the browser", () => {
    const html = renderToString(
      <FlipBook
        pages={["/1.jpg", "/2.jpg", "/3.jpg"]}
        thumbnails
        defaultThumbnailsOpen
        bookmarks={{ persist: "x", defaultValue: [2] }}
        download={{ url: "/book.pdf" }}
        print
        share
        fullscreen
      />,
    );
    expect(html).toContain('aria-label="Flipbook toolbar"');
    expect(html).toContain("Thumbnails");
    // Page 2 is bookmarked and is on the first spread, so the button offers to remove it.
    expect(html).toContain("Remove bookmark");
    expect(html).toContain("Enter fullscreen");
    expect(html).not.toContain("<canvas");
  });
  it("renders search, contents, hotspots, overlays and saved state on the server without touching the browser", () => {
    const html = renderToString(
      <FlipBook
        source="/magazine.pdf"
        search={{ minLength: 3, maxResults: 50 }}
        outline
        links
        onLinkClick={() => false}
        hotspots={[{ id: "a", page: 1, x: 0, y: 0, width: 0.2, height: 0.2, label: "Info", content: "Hello" }]}
        overlays={{ 1: <span>Overlay</span> }}
        urlState={{ hash: true, history: "push" }}
        persistState={{ storage: { getItem: () => null, setItem: () => undefined } }}
      />,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain("Loading");
    // Nothing from the page layer exists until the browser measures the container.
    expect(html).not.toContain("Overlay");
    expect(html).not.toContain("<canvas");
  });

  it("renders image pages with hotspots and overlays on the server", () => {
    const html = renderToString(
      <FlipBook
        pages={["/1.jpg", "/2.jpg"]}
        hotspots={[{ id: "a", page: 1, x: 0, y: 0, width: 0.2, height: 0.2, href: "https://example.com/" }]}
        overlays={{ 2: <b>Over</b> }}
        urlState
        persistState="catalog"
      />,
    );
    expect(html).toContain('role="region"');
  });
});
