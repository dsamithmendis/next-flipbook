// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController } from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";

// Counts how often a thumbnail's picture is rendered, which happens whenever its item is.
const drawn = vi.hoisted(() => ({ count: 0, byPage: new Map<number, number>() }));
vi.mock("../src/react/components/Thumbnail.js", () => ({
  ThumbnailContent: ({ pageNumber }: { pageNumber: number }) => {
    drawn.count += 1;
    drawn.byPage.set(pageNumber, (drawn.byPage.get(pageNumber) ?? 0) + 1);
    return <i data-testid="thumb-picture" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  installDomStubs();
  drawn.count = 0;
  drawn.byPage.clear();
});

const pages = Array.from({ length: 300 }, (_, i) => `/page-${i + 1}.jpg`);

describe("a long thumbnail list", () => {
  it("redraws only the thumbnails that changed when the reader turns the page", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 300");
    await waitFor(() => expect(screen.getAllByTestId("thumb-picture")).toHaveLength(300));

    drawn.count = 0;
    act(() => ref.current!.next());
    await screen.findByText("Pages 3–4 of 300");

    // The two pages that were current and the two that are now. Not all 300.
    expect(drawn.count).toBeLessThanOrEqual(8);
    expect(drawn.count).toBeGreaterThan(0);
  });

  it("redraws one thumbnail when a bookmark is added, not the list", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion thumbnails bookmarks defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 300");
    await waitFor(() => expect(screen.getAllByTestId("thumb-picture")).toHaveLength(300));

    drawn.count = 0;
    act(() => ref.current!.toggleBookmark(1));
    await waitFor(() => expect(drawn.count).toBeGreaterThan(0));
    expect(drawn.count).toBeLessThanOrEqual(2);
    expect(drawn.byPage.get(1)).toBeGreaterThan(0);
  });

  it("does not redraw the list when the reader moves between thumbnails with the keyboard", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 300");
    await waitFor(() => expect(screen.getAllByTestId("thumb-picture")).toHaveLength(300));

    const first = screen.getByRole("button", { name: /Go to page 1\b/ });
    first.focus();
    drawn.count = 0;
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? first, { key: "ArrowDown" });
    // Focus moves between two or three items: those may redraw, the rest must not.
    expect(drawn.count).toBeLessThanOrEqual(6);
  });

  it("still highlights and scrolls to the current page", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 300");
    act(() => ref.current!.goToPage(41));
    await screen.findByText("Pages 41–42 of 300");
    await waitFor(() => {
      const current = screen.getAllByRole("button", { current: "page" });
      expect(current.map((button) => button.getAttribute("data-thumb-page"))).toEqual(["41", "42"]);
    });
  });
});
