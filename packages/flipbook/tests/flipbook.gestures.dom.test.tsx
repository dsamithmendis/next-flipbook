// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController } from "../src/index.js";
import { createFakePdfjs } from "./helpers/fakePdfjs.js";

// jsdom has no PointerEvent. This is just enough of one for the gesture code.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  // jsdom has no canvas; PDF.js is faked, so any context object will do.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 900,
    height: 600,
    top: 0,
    left: 0,
    right: 900,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pages = Array.from({ length: 6 }, (_, index) => ({
  type: "custom" as const,
  render: () => <p>Content {index + 1}</p>,
}));

type PointerType = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

/** Dispatches a pointer event with a controlled timestamp, so speed is deterministic. */
function pointer(
  target: Element,
  type: PointerType,
  at: { x: number; y: number; t: number; id?: number; kind?: string; button?: number },
): Event {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: at.id ?? 1,
    pointerType: at.kind ?? "mouse",
    clientX: at.x,
    clientY: at.y,
    button: at.button ?? 0,
  });
  Object.defineProperty(event, "timeStamp", { value: at.t });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const stage = (container: HTMLElement): HTMLElement =>
  container.querySelector("[data-flipbook-stage]") as HTMLElement;

const leaf = (container: HTMLElement): Element | null =>
  container.querySelector('[data-flipbook-book] > [aria-hidden="true"]');

const transformOf = (container: HTMLElement): { x: number; y: number; zoom: number } => {
  const value = (container.querySelector("[data-flipbook-zoom]") as HTMLElement).style.transform;
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) scale\(([\d.]+)\)/.exec(value);
  if (!match) throw new Error(`unexpected transform: ${value}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
};

const drag = (
  target: HTMLElement,
  from: number,
  to: number,
  options: { y?: number; steps?: number; stepMs?: number; kind?: string; releaseDelay?: number } = {},
): void => {
  const { y = 300, steps = 4, stepMs = 15, kind = "mouse", releaseDelay = 0 } = options;
  pointer(target, "pointerdown", { x: from, y, t: 0, kind });
  for (let step = 1; step <= steps; step += 1) {
    pointer(target, "pointermove", { x: from + ((to - from) * step) / steps, y, t: step * stepMs, kind });
  }
  pointer(target, "pointerup", { x: to, y, t: steps * stepMs + releaseDelay, kind });
};

describe("dragging pages", () => {
  it("lifts the page while dragging and turns it when released past halfway", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" duration={40} />);
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");

    pointer(target, "pointerdown", { x: 700, y: 300, t: 0 });
    pointer(target, "pointermove", { x: 600, y: 300, t: 100 });
    expect(leaf(container)).not.toBeNull();
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();

    pointer(target, "pointermove", { x: 200, y: 300, t: 200 });
    pointer(target, "pointerup", { x: 200, y: 300, t: 400 });
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    await waitFor(() => expect(leaf(container)).toBeNull(), { timeout: 2000 });
    expect(screen.getByText("Content 3")).toBeTruthy();
  });

  it("springs back and stays put when released early without speed", async () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <FlipBook pages={pages} aspectRatio="3/4" duration={40} onPageChange={onPageChange} />,
    );
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");

    pointer(target, "pointerdown", { x: 700, y: 300, t: 0 });
    pointer(target, "pointermove", { x: 670, y: 300, t: 300 });
    pointer(target, "pointerup", { x: 670, y: 300, t: 900 }); // a long pause: no speed
    await waitFor(() => expect(leaf(container)).toBeNull(), { timeout: 2000 });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("turns on a fast flick even from a short drag", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" duration={40} />);
    await screen.findByText("Pages 1–2 of 6");
    drag(stage(container), 700, 640, { steps: 3, stepMs: 8 }); // 60px in 24ms
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    await waitFor(() => expect(leaf(container)).toBeNull(), { timeout: 2000 });
  });

  it("turns backwards when dragged to the right", async () => {
    const { container } = render(
      <FlipBook pages={pages} aspectRatio="3/4" duration={40} initialPage={3} mode="double" />,
    );
    await screen.findByText("Pages 3–4 of 6");
    drag(stage(container), 150, 700);
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
    await waitFor(() => expect(leaf(container)).toBeNull(), { timeout: 2000 });
  });

  it("mirrors the gesture for right-to-left books", async () => {
    const { container } = render(
      <FlipBook pages={pages} aspectRatio="3/4" duration={40} direction="rtl" />,
    );
    await screen.findByText("Pages 1–2 of 6");
    drag(stage(container), 150, 700);
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("does nothing at the first page", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" duration={40} />);
    await screen.findByText("Pages 1–2 of 6");
    drag(stage(container), 150, 700);
    expect(leaf(container)).toBeNull();
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("does nothing when dragToTurn is off", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" dragToTurn={false} />);
    await screen.findByText("Pages 1–2 of 6");
    drag(stage(container), 700, 150);
    expect(leaf(container)).toBeNull();
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("a vertical drag does not turn the page", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" />);
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");
    pointer(target, "pointerdown", { x: 500, y: 100, t: 0, kind: "touch" });
    pointer(target, "pointermove", { x: 490, y: 300, t: 30, kind: "touch" });
    pointer(target, "pointermove", { x: 300, y: 500, t: 60, kind: "touch" });
    pointer(target, "pointerup", { x: 300, y: 500, t: 90, kind: "touch" });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("tolerates unmounting in the middle of a drag", async () => {
    const { container, unmount } = render(<FlipBook pages={pages} aspectRatio="3/4" />);
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");
    pointer(target, "pointerdown", { x: 700, y: 300, t: 0 });
    pointer(target, "pointermove", { x: 500, y: 300, t: 50 });
    expect(() => unmount()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe("dragging under reduced motion", () => {
  it("a long swipe turns the page instantly, with no lifted page", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    drag(stage(container), 700, 500, { stepMs: 40 });
    expect(leaf(container)).toBeNull();
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("a short, slow nudge does not", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    drag(stage(container), 700, 680, { stepMs: 80 });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });
});

describe("clicks and interactive content", () => {
  it("does not start a drag on a button inside a page, and the button still works", async () => {
    const onClick = vi.fn();
    const withButton = [
      { type: "custom" as const, component: <button type="button" onClick={onClick}>Buy</button> },
      ...pages,
    ];
    const { container } = render(<FlipBook pages={withButton} aspectRatio="3/4" mode="single" reducedMotion />);
    await screen.findByText("Page 1 of 7");
    const button = screen.getByRole("button", { name: "Buy" });
    drag(button, 600, 200);
    expect(screen.getByText("Page 1 of 7")).toBeTruthy();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container).toBeTruthy();
  });

  it("swallows the click that follows a drag, but not a plain click", async () => {
    const onClick = vi.fn();
    // The clickable page is the last one, so a drag towards the next page has nowhere to go:
    // the page stays put and stays clickable, which is what lets the test see the click.
    const clickable = [
      ...pages,
      { type: "custom" as const, component: <p onClick={onClick}>Tap me</p> },
    ];
    const { container } = render(
      <FlipBook pages={clickable} aspectRatio="3/4" mode="single" reducedMotion initialPage={7} />,
    );
    await screen.findByText("Page 7 of 7");
    const text = screen.getByText("Tap me");

    drag(stage(container), 700, 300);
    expect(screen.getByText("Page 7 of 7")).toBeTruthy();
    fireEvent.click(text);
    expect(onClick).not.toHaveBeenCalled();

    pointer(stage(container), "pointerdown", { x: 400, y: 300, t: 1000 });
    pointer(stage(container), "pointerup", { x: 400, y: 300, t: 1040 });
    fireEvent.click(text);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("zoom", () => {
  it("double-click zooms in and a second double-click returns to fit", async () => {
    const onZoomChange = vi.fn();
    const { container } = render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion onZoomChange={onZoomChange} />,
    );
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");

    pointer(target, "pointerdown", { x: 450, y: 300, t: 0 });
    pointer(target, "pointerup", { x: 450, y: 300, t: 40 });
    pointer(target, "pointerdown", { x: 452, y: 300, t: 180 });
    pointer(target, "pointerup", { x: 452, y: 300, t: 220 });
    expect(transformOf(container).zoom).toBe(2);
    expect(onZoomChange).toHaveBeenLastCalledWith(2);

    pointer(target, "pointerdown", { x: 450, y: 300, t: 1000 });
    pointer(target, "pointerup", { x: 450, y: 300, t: 1040 });
    pointer(target, "pointerdown", { x: 450, y: 300, t: 1150 });
    pointer(target, "pointerup", { x: 450, y: 300, t: 1190 });
    expect(transformOf(container)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(onZoomChange).toHaveBeenLastCalledWith(1);
  });

  it("double-tap zoom can be turned off or changed", async () => {
    const off = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion doubleTapZoom={false} />);
    await screen.findByText("Pages 1–2 of 6");
    const t = stage(off.container);
    pointer(t, "pointerdown", { x: 450, y: 300, t: 0 });
    pointer(t, "pointerup", { x: 450, y: 300, t: 40 });
    pointer(t, "pointerdown", { x: 450, y: 300, t: 150 });
    pointer(t, "pointerup", { x: 450, y: 300, t: 190 });
    expect(transformOf(off.container).zoom).toBe(1);
    off.unmount();

    const three = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion doubleTapZoom={3} />);
    await screen.findByText("Pages 1–2 of 6");
    const u = stage(three.container);
    pointer(u, "pointerdown", { x: 450, y: 300, t: 0 });
    pointer(u, "pointerup", { x: 450, y: 300, t: 40 });
    pointer(u, "pointerdown", { x: 450, y: 300, t: 150 });
    pointer(u, "pointerup", { x: 450, y: 300, t: 190 });
    expect(transformOf(three.container).zoom).toBe(3);
  });

  it("pinches in with two fingers, then reports the settled zoom once", async () => {
    const onZoomChange = vi.fn();
    const { container } = render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion onZoomChange={onZoomChange} />,
    );
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");

    pointer(target, "pointerdown", { id: 1, x: 400, y: 300, t: 0, kind: "touch" });
    pointer(target, "pointerdown", { id: 2, x: 500, y: 300, t: 10, kind: "touch" });
    pointer(target, "pointermove", { id: 2, x: 600, y: 300, t: 30, kind: "touch" });
    pointer(target, "pointermove", { id: 2, x: 700, y: 300, t: 50, kind: "touch" });
    expect(transformOf(container).zoom).toBe(3);
    expect(onZoomChange).not.toHaveBeenCalled();

    pointer(target, "pointerup", { id: 2, x: 700, y: 300, t: 70, kind: "touch" });
    pointer(target, "pointerup", { id: 1, x: 400, y: 300, t: 80, kind: "touch" });
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(3);
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("never turns a page while pinching", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");
    pointer(target, "pointerdown", { id: 1, x: 700, y: 300, t: 0, kind: "touch" });
    pointer(target, "pointerdown", { id: 2, x: 760, y: 300, t: 5, kind: "touch" });
    pointer(target, "pointermove", { id: 1, x: 200, y: 300, t: 30, kind: "touch" });
    pointer(target, "pointermove", { id: 1, x: 100, y: 300, t: 60, kind: "touch" });
    pointer(target, "pointerup", { id: 2, x: 760, y: 300, t: 80, kind: "touch" });
    pointer(target, "pointerup", { id: 1, x: 100, y: 300, t: 90, kind: "touch" });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("pans instead of turning when zoomed in, and stops at the edge", async () => {
    const ref = createRef<FlipBookController>();
    const { container } = render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion />);
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");
    act(() => ref.current?.setZoom(2));

    drag(target, 700, 600, { stepMs: 20 });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
    expect(leaf(container)).toBeNull();
    expect(transformOf(container).x).toBe(-100);

    drag(target, 800, 100, { stepMs: 20 });
    // The book is 852px wide at 1x, so at 2x it can move at most (1704 - 900) / 2 px.
    expect(transformOf(container).x).toBe(-402);
  });

  it("switches touch-action so a touch can pan once zoomed", async () => {
    const ref = createRef<FlipBookController>();
    const { container } = render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    expect(stage(container).style.touchAction).toBe("pan-y");
    act(() => ref.current?.setZoom(2));
    expect(stage(container).style.touchAction).toBe("none");
    act(() => ref.current?.fit());
    expect(stage(container).style.touchAction).toBe("pan-y");
  });

  it("Ctrl+wheel zooms about the pointer and blocks the browser's own zoom", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");

    const handled = fireEvent.wheel(target, { deltaY: -50, ctrlKey: true, clientX: 450, clientY: 300 });
    expect(handled).toBe(false); // preventDefault was called
    expect(transformOf(container).zoom).toBeGreaterThan(1);

    const before = transformOf(container).zoom;
    const plain = fireEvent.wheel(target, { deltaY: -100, clientX: 450, clientY: 300 });
    expect(plain).toBe(false); // zoomed in: a plain wheel pans, so it is also claimed
    expect(transformOf(container).zoom).toBe(before);
  });

  it("leaves a plain wheel alone at the fitted size, so the page can scroll", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    const handled = fireEvent.wheel(stage(container), { deltaY: 120 });
    expect(handled).toBe(true);
    expect(transformOf(container).zoom).toBe(1);
  });

  it("wheelZoom={true} zooms on a plain wheel, wheelZoom={false} never does", async () => {
    const on = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion wheelZoom />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.wheel(stage(on.container), { deltaY: -100 });
    expect(transformOf(on.container).zoom).toBeGreaterThan(1);
    on.unmount();

    const off = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion wheelZoom={false} />);
    await screen.findByText("Pages 1–2 of 6");
    const handled = fireEvent.wheel(stage(off.container), { deltaY: -100, ctrlKey: true });
    expect(handled).toBe(true);
    expect(transformOf(off.container).zoom).toBe(1);
  });

  it("zooms with the + - and 0 keys", async () => {
    const { container } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    const region = screen.getByRole("region", { name: "Flipbook" });
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.keyDown(region, { key: "+" });
    expect(transformOf(container).zoom).toBe(1.25);
    fireEvent.keyDown(region, { key: "=" });
    expect(transformOf(container).zoom).toBe(1.5);
    fireEvent.keyDown(region, { key: "-" });
    expect(transformOf(container).zoom).toBe(1.25);
    fireEvent.keyDown(region, { key: "0" });
    expect(transformOf(container).zoom).toBe(1);
  });

  it("zoom={false} turns every zoom path off", async () => {
    const ref = createRef<FlipBookController>();
    const { container } = render(
      <FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion zoom={false} />,
    );
    const region = screen.getByRole("region", { name: "Flipbook" });
    const target = stage(container);
    await screen.findByText("Pages 1–2 of 6");

    fireEvent.keyDown(region, { key: "+" });
    act(() => ref.current?.zoomIn());
    act(() => ref.current?.setZoom(3));
    const handled = fireEvent.wheel(target, { deltaY: -100, ctrlKey: true });
    pointer(target, "pointerdown", { x: 450, y: 300, t: 0 });
    pointer(target, "pointerup", { x: 450, y: 300, t: 40 });
    pointer(target, "pointerdown", { x: 450, y: 300, t: 150 });
    pointer(target, "pointerup", { x: 450, y: 300, t: 190 });

    expect(handled).toBe(true);
    expect(ref.current?.getZoom()).toBe(1);
    expect(transformOf(container).zoom).toBe(1);
  });

  it("honours minZoom and maxZoom", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion minZoom={0.5} maxZoom={2} />);
    await screen.findByText("Pages 1–2 of 6");
    act(() => ref.current?.setZoom(9));
    expect(ref.current?.getZoom()).toBe(2);
    act(() => ref.current?.setZoom(0.1));
    expect(ref.current?.getZoom()).toBe(0.5);
  });

  it("exposes zoom through the controller", async () => {
    const ref = createRef<FlipBookController>();
    const { container } = render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    act(() => ref.current?.zoomIn());
    expect(ref.current?.getZoom()).toBe(1.25);
    act(() => ref.current?.zoomOut());
    expect(ref.current?.getZoom()).toBe(1);
    act(() => ref.current?.fitWidth());
    // 900px wide view, 16px padding each side, 852px book: a little over 1x.
    expect(ref.current?.getZoom()).toBeCloseTo((900 - 32) / 852, 2);
    act(() => ref.current?.fit());
    expect(transformOf(container)).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("animates zoom when motion is allowed", async () => {
    const ref = createRef<FlipBookController>();
    const { container } = render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" />);
    await screen.findByText("Pages 1–2 of 6");
    act(() => ref.current?.setZoom(2));
    expect(transformOf(container).zoom).toBeLessThan(2); // still on its way
    await waitFor(() => expect(transformOf(container).zoom).toBe(2), { timeout: 2000 });
  });
});

describe("zoom and PDF pages", () => {
  it("renders the visible pages sharper once the zoom settles, and prefetches at the fitted size", async () => {
    const fake = createFakePdfjs({ autoRender: true, numPages: 6 });
    const ref = createRef<FlipBookController>();
    render(
      <FlipBook
        ref={ref}
        source="/doc.pdf"
        pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/w.mjs" }}
        reducedMotion
        mode="double"
      />,
    );
    await screen.findByText("Pages 1–2 of 6");
    await waitFor(() => expect(fake.renders.some((r) => r.docPage === 1)).toBe(true));
    const fitted = fake.renders.find((r) => r.docPage === 1)?.scale as number;
    expect(fitted).toBeGreaterThan(0);

    act(() => ref.current?.setZoom(2));
    await waitFor(
      () => {
        const sharp = fake.renders.filter((r) => r.docPage === 1 && r.scale > fitted);
        expect(sharp.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
    const sharpScale = Math.max(...fake.renders.filter((r) => r.docPage === 1).map((r) => r.scale));
    expect(sharpScale).toBeGreaterThanOrEqual(fitted * 1.9);

    // Neighbouring pages are still prepared at the cheaper fitted size.
    const neighbour = fake.renders.filter((r) => r.docPage === 3).map((r) => r.scale);
    expect(neighbour.length).toBeGreaterThan(0);
    expect(Math.max(...neighbour)).toBeCloseTo(fitted, 5);
  });
});
