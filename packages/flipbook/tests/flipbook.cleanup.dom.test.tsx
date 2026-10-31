// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController } from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";
import { createFakePdfjs, settle } from "./helpers/fakePdfjs.js";

/**
 * Leaving a page that holds a book has to leave nothing behind: no PDF.js document or loading
 * task, no render still running, no listeners on the window or document, no observers, no
 * timers, and no canvas holding pixels. A single-page app mounts and unmounts books all day.
 */

// ---- what is left behind ------------------------------------------------------------------

const canvases: HTMLCanvasElement[] = [];
const listeners = new Set<string>();
const timeouts = new Set<number>();
const intervals = new Set<number>();
const observers = { resize: 0, intersection: 0 };
const identities = new WeakMap<object, number>();
let nextIdentity = 1;

function identify(listener: unknown): number {
  if (typeof listener !== "object" && typeof listener !== "function") return 0;
  if (listener === null) return 0;
  let id = identities.get(listener);
  if (id === undefined) {
    id = nextIdentity;
    nextIdentity += 1;
    identities.set(listener, id);
  }
  return id;
}

function trackListeners(target: EventTarget, name: string): void {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const capture = (options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
    typeof options === "boolean" ? options : (options?.capture ?? false);
  vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
    // A listener that removes itself, or goes with an abort signal, cannot be left behind.
    const own = typeof options === "object" && options !== null && (options.once || options.signal);
    if (!own) listeners.add(`${name}:${type}:${capture(options)}:${identify(listener)}`);
    add(type, listener, options);
  });
  vi.spyOn(target, "removeEventListener").mockImplementation((type, listener, options) => {
    listeners.delete(`${name}:${type}:${capture(options)}:${identify(listener)}`);
    remove(type, listener, options);
  });
}

function trackTimers(): void {
  // The DOM's timer functions, whose ids are numbers (Node's would be objects).
  const set = window.setTimeout.bind(window) as unknown as (handler: (...args: unknown[]) => void, delay?: number, ...rest: unknown[]) => number;
  const clear = window.clearTimeout.bind(window) as unknown as (id?: number) => void;
  vi.spyOn(window, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
    const id: number = set((...args: unknown[]) => {
      timeouts.delete(id);
      if (typeof handler === "function") (handler as (...rest: unknown[]) => void)(...args);
    }, delay, ...rest);
    timeouts.add(id);
    return id;
  }) as unknown as typeof window.setTimeout);
  vi.spyOn(window, "clearTimeout").mockImplementation(((id?: number) => {
    if (id !== undefined) timeouts.delete(id);
    clear(id);
  }) as unknown as typeof window.clearTimeout);
  const setEvery = window.setInterval.bind(window) as unknown as (handler: TimerHandler, delay?: number, ...rest: unknown[]) => number;
  const clearEvery = window.clearInterval.bind(window) as unknown as (id?: number) => void;
  vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
    const id = setEvery(handler, delay, ...rest);
    intervals.add(id);
    return id;
  }) as unknown as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
    if (id !== undefined) intervals.delete(id);
    clearEvery(id);
  }) as unknown as typeof window.clearInterval);
}

function trackObservers(): void {
  class CountedResizeObserver {
    private watching = 0;
    observe(): void {
      this.watching += 1;
      if (this.watching === 1) observers.resize += 1;
    }
    unobserve(): void {}
    disconnect(): void {
      if (this.watching > 0) observers.resize -= 1;
      this.watching = 0;
    }
  }
  class CountedIntersectionObserver {
    private watching = 0;
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(element: Element): void {
      this.watching += 1;
      if (this.watching === 1) observers.intersection += 1;
      queueMicrotask(() =>
        this.callback(
          [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
      );
    }
    unobserve(): void {}
    disconnect(): void {
      if (this.watching > 0) observers.intersection -= 1;
      this.watching = 0;
    }
  }
  vi.stubGlobal("ResizeObserver", CountedResizeObserver);
  vi.stubGlobal("IntersectionObserver", CountedIntersectionObserver);
}

function trackCanvases(): void {
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = create(tag, options);
    if (tag === "canvas") canvases.push(element as HTMLCanvasElement);
    return element;
  }));
}

beforeEach(() => {
  installDomStubs();
  canvases.length = 0;
  listeners.clear();
  timeouts.clear();
  intervals.clear();
  observers.resize = 0;
  observers.intersection = 0;
  trackObservers();
  trackCanvases();
  trackListeners(window, "window");
  trackListeners(document, "document");
  trackTimers();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- the visits ---------------------------------------------------------------------------

function openBook(options: { autoRender?: boolean; strict?: boolean } = {}) {
  const { autoRender = true, strict = false } = options;
  const fake = createFakePdfjs({
    autoRender,
    numPages: 30,
    text: { 1: "hello world", 2: "hello again", 3: "something else" },
  });
  const ref = createRef<FlipBookController>();
  const book = (
    <FlipBook
      ref={ref}
      source="/doc.pdf"
      pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/pdf.worker.mjs" }}
      reducedMotion
      thumbnails
      bookmarks={{ persist: "cleanup-test" }}
      search
      persistState
      urlState
      defaultThumbnailsOpen
      cacheSize={6}
    />
  );
  const view = render(strict ? <StrictMode>{book}</StrictMode> : book);
  return { fake, ref, view };
}

/** Reads a little, bookmarks, searches: the things that start work. */
async function useBook(handle: ReturnType<typeof openBook>): Promise<void> {
  await screen.findByText("Pages 1–2 of 30");
  await waitFor(() => expect(handle.fake.renders.length).toBeGreaterThanOrEqual(2));
  await act(async () => {
    handle.ref.current!.next();
    handle.ref.current!.toggleBookmark(3);
    await handle.ref.current!.search("hello");
    // Searching opens its own panel; bring the thumbnails back so their observers are live too.
    handle.ref.current!.openPanel("thumbnails");
  });
  await waitFor(() => expect(observers.intersection).toBeGreaterThan(0));
  await settle();
}

const pendingNow = () => ({
  listeners: [...listeners],
  timeouts: timeouts.size,
  intervals: intervals.size,
  resizeObservers: observers.resize,
  intersectionObservers: observers.intersection,
});

describe("leaving a page that holds a PDF book", () => {
  it("destroys the document and its loading task, and cancels what is still rendering", async () => {
    const handle = openBook({ autoRender: false });
    await useBook(handle);
    const { fake } = handle;
    expect(fake.renders.some((render) => !render.settled)).toBe(true);

    handle.view.unmount();
    await settle();

    expect(fake.stats.initCalls).toHaveLength(1);
    // Destroying the loading task is how PDF.js frees the document, its pages and the worker side.
    expect(fake.stats.tasksDestroyed).toBe(1);
    // Nothing is left running: every render either finished or was cancelled.
    expect(fake.renders.filter((render) => !render.settled && !render.cancelled)).toEqual([]);
  });

  it("gives up a book that is unmounted while its document is still loading", async () => {
    const handle = openBook();
    handle.view.unmount();
    await settle();
    await settle();
    expect(handle.fake.stats.initCalls.length).toBeLessThanOrEqual(1);
    expect(handle.fake.stats.tasksDestroyed).toBe(handle.fake.stats.initCalls.length);
  });

  it("holds exactly one document at a time under StrictMode, and none afterwards", async () => {
    const handle = openBook({ strict: true });
    await useBook(handle);
    const { stats } = handle.fake;
    expect(stats.initCalls.length - stats.tasksDestroyed).toBe(1);

    handle.view.unmount();
    await settle();
    expect(stats.initCalls.length - stats.tasksDestroyed).toBe(0);
  });

  it("releases the pixels of every canvas it drew", async () => {
    const handle = openBook();
    await useBook(handle);
    expect(canvases.length).toBeGreaterThan(0);
    expect(canvases.some((canvas) => canvas.width > 0)).toBe(true);

    handle.view.unmount();
    await settle();
    expect(canvases.filter((canvas) => canvas.width > 0 || canvas.height > 0)).toHaveLength(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("leaves no listeners, observers or timers behind, however many times it is opened", async () => {
    // The first visit warms up whatever React and the test tools keep for good.
    const first = openBook();
    await useBook(first);
    // There is something to clean up: the checks below are not passing because nothing was registered.
    const during = pendingNow();
    expect(during.resizeObservers).toBeGreaterThan(0);
    expect(during.intersectionObservers).toBeGreaterThan(0);
    expect(during.listeners.some((entry) => entry.startsWith("window:storage"))).toBe(true);
    expect(during.listeners.some((entry) => entry.startsWith("window:popstate"))).toBe(true);
    first.view.unmount();
    await settle();
    const baseline = pendingNow();

    const documents: ReturnType<typeof createFakePdfjs>[] = [];
    for (let visit = 0; visit < 6; visit += 1) {
      const handle = openBook();
      await useBook(handle);
      handle.view.unmount();
      await settle();
      documents.push(handle.fake);
    }

    expect(pendingNow()).toEqual(baseline);
    expect(baseline.resizeObservers).toBe(0);
    expect(baseline.intersectionObservers).toBe(0);
    expect(baseline.intervals).toBe(0);
    for (const fake of documents) {
      expect(fake.stats.initCalls).toHaveLength(1);
      expect(fake.stats.tasksDestroyed).toBe(1);
    }
    expect(canvases.filter((canvas) => canvas.width > 0)).toHaveLength(0);
  });

  it("is safe to use the controller after the book has gone", async () => {
    const handle = openBook();
    await useBook(handle);
    const controller = handle.ref.current!;
    handle.view.unmount();
    await settle();

    // A stale reference held by the app must not throw, start work, or bring anything back.
    expect(() => {
      controller.next();
      controller.goToPage(9);
      controller.toggleBookmark(2);
      controller.zoomIn();
      controller.getCacheStats();
    }).not.toThrow();
    await expect(controller.search("hello")).resolves.toBeUndefined();
    await settle();
    expect(handle.fake.renders.filter((render) => !render.settled && !render.cancelled)).toEqual([]);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });
});

describe("the checks above", () => {
  it("notice a listener, timer, interval or observer that is left behind", () => {
    const leaked = () => undefined;
    window.addEventListener("resize", leaked);
    document.addEventListener("keydown", leaked, true);
    const interval = window.setInterval(leaked, 100000);
    const timeout = window.setTimeout(leaked, 100000);
    const resize = new ResizeObserver(() => undefined);
    resize.observe(document.body);
    const intersection = new IntersectionObserver(() => undefined);
    intersection.observe(document.body);

    expect(pendingNow()).toMatchObject({ timeouts: 1, intervals: 1, resizeObservers: 1, intersectionObservers: 1 });
    expect(pendingNow().listeners).toHaveLength(2);

    window.removeEventListener("resize", leaked);
    document.removeEventListener("keydown", leaked, true);
    window.clearInterval(interval);
    window.clearTimeout(timeout);
    resize.disconnect();
    intersection.disconnect();
    expect(pendingNow()).toEqual({ listeners: [], timeouts: 0, intervals: 0, resizeObservers: 0, intersectionObservers: 0 });
  });
});
