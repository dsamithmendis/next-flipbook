// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController } from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";

// A thumbnail's picture is a plain marker here, so the tests see which ones the list chose to draw.
vi.mock("../src/react/components/Thumbnail.js", () => ({
  ThumbnailContent: ({ pageNumber }: { pageNumber: number }) => <i data-testid="thumb-picture" data-page={pageNumber} />,
}));

const pages = Array.from({ length: 300 }, (_, i) => `/page-${i + 1}.jpg`);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});
beforeEach(() => {
  installDomStubs();
});

describe("a long thumbnail list, scrolling to the current page", () => {
  it("goes straight to a page that is far away and glides to one that is near", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    // A list 400 px tall whose thumbnails are 100 px apart.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const page = Number(this.dataset?.thumbPage);
      const top = Number.isFinite(page) ? (page - 1) * 100 : 0;
      return { width: 900, height: 600, top, left: 0, right: 900, bottom: top + 600, x: 0, y: top, toJSON: () => ({}) };
    });
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" duration={10} thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 300");

    // Arriving, the list is placed at once: there is nothing to glide from.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.calls[0]?.[0]).toEqual({ block: "nearest", behavior: "auto" });

    scrollIntoView.mockClear();
    act(() => ref.current!.goToPage(4));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.lastCall?.[0]).toEqual({ block: "nearest", behavior: "smooth" });

    scrollIntoView.mockClear();
    act(() => ref.current!.goToPage(250));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.lastCall?.[0]).toEqual({ block: "nearest", behavior: "auto" });
  });
});

/** An IntersectionObserver the test drives by hand. */
class HandObserver {
  static all: HandObserver[] = [];
  readonly watched = new Map<number, Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    HandObserver.all.push(this);
  }
  observe(element: Element): void {
    this.watched.set(Number((element as HTMLElement).dataset.thumbPage), element);
  }
  unobserve(): void {}
  disconnect(): void {
    this.watched.clear();
  }
  report(list: number[], isIntersecting: boolean): void {
    const entries = list.map((page) => ({ target: this.watched.get(page), isIntersecting }));
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

describe("a long thumbnail list, drawing pictures", () => {
  const drawn = (): number[] =>
    screen
      .queryAllByTestId("thumb-picture")
      .map((element) => Number(element.getAttribute("data-page")))
      .sort((a, b) => a - b);
  const list = (): HandObserver => HandObserver.all.find((observer) => observer.watched.size > 0)!;
  const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  beforeEach(() => {
    HandObserver.all = [];
    vi.stubGlobal("IntersectionObserver", HandObserver);
    // Time is the test's: how long a thumbnail has stayed in view is what is being checked.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });

  it("draws the first screenful at once", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    expect(drawn()).toEqual([]);
    act(() => list().report(range(1, 6), true));
    expect(drawn()).toEqual(range(1, 6));
  });

  it("does not draw thumbnails that only pass by during a fast scroll", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    act(() => list().report(range(1, 6), true));
    act(() => void vi.advanceTimersByTime(500));

    // Pages 100 to 105 come into range and leave again before anyone could look at them.
    act(() => list().report(range(100, 105), true));
    act(() => void vi.advanceTimersByTime(30));
    // While they are in range they have not been drawn: nothing has asked for a render.
    expect(drawn()).toEqual(range(1, 6));
    act(() => list().report(range(100, 105), false));
    act(() => void vi.advanceTimersByTime(500));
    expect(drawn()).toEqual(range(1, 6));
  });

  it("draws thumbnails that stay in range, and stops drawing the ones that left", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    act(() => list().report(range(1, 6), true));
    act(() => void vi.advanceTimersByTime(500));

    act(() => list().report(range(200, 205), true));
    // Not yet: they have not stayed long enough.
    expect(drawn()).toEqual(range(1, 6));
    act(() => void vi.advanceTimersByTime(150));
    expect(drawn()).toEqual([...range(1, 6), ...range(200, 205)]);

    // Leaving takes the picture away at once, which also cancels a render that has not started.
    act(() => list().report(range(1, 6), false));
    expect(drawn()).toEqual(range(200, 205));
  });

  it("stops waiting when the list goes away", () => {
    const view = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    act(() => list().report(range(1, 6), true));
    act(() => void vi.advanceTimersByTime(500));
    act(() => list().report(range(200, 205), true));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
