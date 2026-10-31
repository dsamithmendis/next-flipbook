// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController } from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";
import { createFakePdfjs, settle, type FakePdfConfig } from "./helpers/fakePdfjs.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => installDomStubs());

function viewer(config: FakePdfConfig = {}) {
  const fake = createFakePdfjs({ autoRender: true, numPages: 30, ...config });
  const pdf = { loadPdfjs: fake.loadPdfjs, workerSrc: "/pdf.worker.mjs" };
  return { fake, pdf };
}

describe("memory in a mounted book", () => {
  it("reports what the viewer holds through the controller", async () => {
    const { fake, pdf } = viewer();
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} source="/doc.pdf" pdf={pdf} reducedMotion />);
    await screen.findByText("Pages 1–2 of 30");
    await waitFor(() => expect(fake.renders.length).toBeGreaterThanOrEqual(2));
    await settle();

    const stats = ref.current!.getCacheStats();
    expect(stats.pages.entries).toBeGreaterThanOrEqual(2);
    expect(stats.pages.bytes).toBeGreaterThan(0);
    expect(stats.pages.peakEntries).toBeGreaterThanOrEqual(stats.pages.entries);
    expect(stats.thumbnails.entries).toBe(0);
    expect(stats.text).toEqual({ pages: 0, bytes: 0 });
  });

  it("reports nothing for a book without a PDF", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={["/1.jpg", "/2.jpg", "/3.jpg"]} reducedMotion />);
    await screen.findByText("Pages 1–2 of 3");
    const stats = ref.current!.getCacheStats();
    expect(stats.pages).toMatchObject({ entries: 0, bytes: 0, hits: 0, misses: 0, evictions: 0 });
    expect(stats.text).toEqual({ pages: 0, bytes: 0 });
  });

  it("does not draw pages it has no room to keep when preloadPages is larger than cacheSize", async () => {
    const { fake, pdf } = viewer();
    const ref = createRef<FlipBookController>();
    // Two on screen and ten either side would need 22 slots. The cache has 4.
    render(<FlipBook ref={ref} source="/doc.pdf" pdf={pdf} reducedMotion cacheSize={4} preloadPages={10} />);
    await screen.findByText("Pages 1–2 of 30");
    await waitFor(() => expect(fake.renders.length).toBeGreaterThanOrEqual(4));
    await settle(12);

    expect(fake.renders).toHaveLength(4);
    expect(new Set(fake.renders.map((r) => r.docPage))).toEqual(new Set([1, 2, 3, 4]));
    expect(ref.current!.getCacheStats().pages.evictions).toBe(0);
  });

  it("does not draw anything again as the reader turns through the book", async () => {
    const { fake, pdf } = viewer();
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} source="/doc.pdf" pdf={pdf} reducedMotion cacheSize={8} preloadPages={2} />);
    await screen.findByText("Pages 1–2 of 30");
    // At the start there is nothing before the spread, so the window is the spread and two pages after it.
    await waitFor(() => expect(fake.renders.length).toBeGreaterThanOrEqual(4));

    for (let turn = 0; turn < 6; turn += 1) {
      ref.current!.next();
      await settle(8);
    }
    // Reading forward, every page is drawn exactly once.
    const drawn = fake.renders.map((r) => r.docPage);
    expect(drawn.length).toBeGreaterThan(10);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(ref.current!.getCacheStats().pages.entries).toBeLessThanOrEqual(8);
  });
});
