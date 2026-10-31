import { describe, expect, it } from "vitest";
import { ZoomController, type ZoomConfig, type ZoomTransform } from "../src/core/zoom/ZoomController.js";
import { FakeScheduler } from "./helpers/fakeScheduler.js";
import { FakeTimers } from "./helpers/fakeTimers.js";

function make(config: Partial<ZoomConfig> = {}) {
  const scheduler = new FakeScheduler();
  const timers = new FakeTimers();
  const zoom = new ZoomController(config, {
    scheduler,
    setTimer: timers.set,
    clearTimer: timers.clear,
    settleMs: 160,
  });
  // A 600x400 book in an 800x600 view: at 2x it is 1200x800, so there is room to pan.
  zoom.setViewport({ viewWidth: 800, viewHeight: 600, contentWidth: 600, contentHeight: 400, padding: 20 });
  const finish = () => {
    scheduler.advance(400);
    timers.advance(400);
  };
  return { zoom, scheduler, timers, finish };
}

describe("ZoomController: stepping", () => {
  it("zooms in and out by the step, animated", () => {
    const { zoom, scheduler, finish } = make();
    zoom.zoomIn();
    expect(scheduler.pending).toBe(1);
    expect(zoom.getZoom()).toBe(1);
    finish();
    expect(zoom.getZoom()).toBe(1.25);
    zoom.zoomIn();
    finish();
    expect(zoom.getZoom()).toBe(1.5);
    zoom.zoomOut();
    finish();
    expect(zoom.getZoom()).toBe(1.25);
  });

  it("steps along the grid from an off-grid zoom", () => {
    const { zoom, finish } = make();
    zoom.zoomTo(1.1, { animate: false });
    zoom.zoomIn();
    finish();
    expect(zoom.getZoom()).toBe(1.25);
    zoom.zoomTo(1.1, { animate: false });
    zoom.zoomOut();
    finish();
    expect(zoom.getZoom()).toBe(1);
  });

  it("clamps to the limits", () => {
    const { zoom } = make({ minZoom: 0.5, maxZoom: 3 });
    zoom.zoomTo(10, { animate: false });
    expect(zoom.getZoom()).toBe(3);
    zoom.zoomTo(0.01, { animate: false });
    expect(zoom.getZoom()).toBe(0.5);
    expect(zoom.getSnapshot()).toMatchObject({ canZoomIn: true, canZoomOut: false });
  });

  it("is instant under reduced motion", () => {
    const { zoom, scheduler } = make({ reducedMotion: true });
    zoom.zoomIn();
    expect(scheduler.pending).toBe(0);
    expect(zoom.getZoom()).toBe(1.25);
  });

  it("reports the end of an animation as settled", () => {
    const { zoom, finish } = make();
    const reported: number[] = [];
    zoom.onChange((value) => reported.push(value));
    zoom.zoomTo(2);
    finish();
    expect(reported).toEqual([2]);
  });
});

describe("ZoomController: focal point and pan", () => {
  it("keeps the content under the focal point in place", () => {
    const { zoom } = make();
    zoom.zoomTo(2, { focal: { x: 100, y: 50 }, animate: false });
    const t = zoom.getTransform();
    expect(t.zoom).toBe(2);
    // A point at (100, 50) in unzoomed space must still render at (100, 50).
    expect(t.panX + t.zoom * 0 + (100 - t.panX)).toBe(100);
    expect(t.panX).toBe(-100);
    expect(t.panY).toBe(-50);
  });

  it("zoomAround scales by a factor about a point", () => {
    const { zoom } = make();
    zoom.zoomAround(1.5, { x: 100, y: 0 });
    expect(zoom.getZoom()).toBe(1.5);
    expect(zoom.getTransform().panX).toBeCloseTo(-50);
  });

  it("clamps panning so the book cannot leave the view", () => {
    const { zoom } = make();
    zoom.zoomTo(2, { animate: false });
    zoom.panBy(5000, -5000);
    expect(zoom.getTransform()).toMatchObject({ panX: 200, panY: -100 });
  });

  it("cannot pan a book that is smaller than the view", () => {
    const { zoom } = make();
    zoom.panBy(300, 300);
    expect(zoom.getTransform()).toMatchObject({ panX: 0, panY: 0 });
  });

  it("re-clamps pan when the view grows", () => {
    const { zoom } = make();
    zoom.zoomTo(2, { animate: false });
    zoom.panBy(200, 0);
    zoom.setViewport({ viewWidth: 1200, viewHeight: 600, contentWidth: 600, contentHeight: 400, padding: 20 });
    expect(zoom.getTransform().panX).toBe(0);
  });
});

describe("ZoomController: fit modes and toggle", () => {
  it("fit returns to the centred, fitted size", () => {
    const { zoom, finish } = make();
    zoom.zoomTo(2, { animate: false });
    zoom.panBy(100, 50);
    zoom.fit();
    finish();
    expect(zoom.getTransform()).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it("fitWidth and fitHeight fill the view minus padding", () => {
    const { zoom, finish } = make({ maxZoom: 4 });
    zoom.fitWidth();
    finish();
    expect(zoom.getZoom()).toBeCloseTo((800 - 40) / 600, 3);
    zoom.fitHeight();
    finish();
    expect(zoom.getZoom()).toBeCloseTo((600 - 40) / 400, 3);
  });

  it("double-tap toggles between fitted and the double-tap zoom", () => {
    const { zoom, finish } = make({ doubleTapZoom: 2.5 });
    zoom.toggle({ x: 10, y: 10 });
    finish();
    expect(zoom.getZoom()).toBe(2.5);
    zoom.toggle();
    finish();
    expect(zoom.getZoom()).toBe(1);
  });
});

describe("ZoomController: pinch", () => {
  it("scales relative to the start of the pinch", () => {
    const { zoom } = make();
    zoom.beginPinch({ x: 0, y: 0 });
    zoom.pinchTo(2, { x: 0, y: 0 });
    expect(zoom.getZoom()).toBe(2);
    zoom.pinchTo(1.5, { x: 0, y: 0 });
    expect(zoom.getZoom()).toBe(1.5);
  });

  it("also pans when the fingers move together", () => {
    const { zoom } = make();
    zoom.beginPinch({ x: 0, y: 0 });
    zoom.pinchTo(2, { x: -60, y: -20 });
    expect(zoom.getTransform()).toMatchObject({ zoom: 2, panX: -60, panY: -20 });
  });

  it("stops at the maximum and the minimum", () => {
    const { zoom } = make({ minZoom: 1, maxZoom: 3 });
    zoom.beginPinch({ x: 0, y: 0 });
    zoom.pinchTo(50, { x: 0, y: 0 });
    expect(zoom.getZoom()).toBe(3);
    zoom.pinchTo(0.01, { x: 0, y: 0 });
    expect(zoom.getZoom()).toBe(1);
  });

  it("settles when the pinch ends", () => {
    const { zoom } = make();
    const reported: number[] = [];
    zoom.onChange((value) => reported.push(value));
    zoom.beginPinch({ x: 0, y: 0 });
    zoom.pinchTo(2, { x: 0, y: 0 });
    expect(zoom.getSnapshot().zoom).toBe(1);
    zoom.endPinch();
    expect(zoom.getSnapshot().zoom).toBe(2);
    expect(reported).toEqual([2]);
  });

  it("is ignored without a begin", () => {
    const { zoom } = make();
    zoom.pinchTo(2, { x: 0, y: 0 });
    expect(zoom.getZoom()).toBe(1);
  });
});

describe("ZoomController: state for rendering", () => {
  it("keeps the snapshot stable while panning", () => {
    const { zoom } = make();
    zoom.zoomTo(2, { animate: false });
    const before = zoom.getSnapshot();
    let renders = 0;
    zoom.subscribe(() => {
      renders += 1;
    });
    zoom.panBy(10, 10);
    zoom.panBy(10, 10);
    expect(zoom.getSnapshot()).toBe(before);
    expect(renders).toBe(0);
  });

  it("flips `zoomed` immediately but reports the zoom value only once it settles", () => {
    const { zoom, timers } = make();
    zoom.zoomAround(1.5, { x: 0, y: 0 });
    expect(zoom.getSnapshot()).toMatchObject({ zoomed: true, zoom: 1 });
    timers.advance(100);
    expect(zoom.getSnapshot().zoom).toBe(1);
    timers.advance(100);
    expect(zoom.getSnapshot().zoom).toBe(1.5);
  });

  it("settles after the last change of a stream of changes, and reports once", () => {
    const { zoom, timers } = make();
    const reported: number[] = [];
    zoom.onChange((value) => reported.push(value));
    for (let i = 1; i <= 5; i += 1) {
      zoom.zoomAround(1.1, { x: 0, y: 0 });
      timers.advance(50);
    }
    expect(reported).toEqual([]);
    timers.advance(200);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeCloseTo(1.61, 2);
  });

  it("tells transform listeners about every change", () => {
    const { zoom } = make();
    const seen: ZoomTransform[] = [];
    zoom.subscribeTransform((t) => seen.push(t));
    zoom.zoomTo(2, { animate: false });
    zoom.panBy(20, 0);
    zoom.panBy(20, 0);
    expect(seen.map((t) => t.panX)).toEqual([0, 20, 40]);
  });

  it("does not notify when nothing changes", () => {
    const { zoom } = make();
    let calls = 0;
    zoom.subscribeTransform(() => {
      calls += 1;
    });
    zoom.panBy(10, 10); // book fits: pan clamps to zero
    zoom.zoomTo(1, { animate: false });
    expect(calls).toBe(0);
  });
});

describe("ZoomController: disabled and lifecycle", () => {
  it("ignores everything when disabled", () => {
    const { zoom, scheduler } = make({ enabled: false });
    zoom.zoomIn();
    zoom.zoomTo(3);
    zoom.zoomAround(2, { x: 0, y: 0 });
    zoom.beginPinch({ x: 0, y: 0 });
    zoom.pinchTo(2, { x: 0, y: 0 });
    zoom.toggle();
    expect(zoom.getZoom()).toBe(1);
    expect(scheduler.pending).toBe(0);
    expect(zoom.getSnapshot()).toMatchObject({ canZoomIn: false, canZoomOut: false });
  });

  it("resets to fitted when it becomes disabled", () => {
    const { zoom } = make();
    zoom.zoomTo(2, { animate: false });
    zoom.configure({ enabled: false });
    expect(zoom.getTransform()).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(zoom.getSnapshot().zoomed).toBe(false);
  });

  it("clamps the current zoom when the limits tighten", () => {
    const { zoom } = make();
    zoom.zoomTo(3, { animate: false });
    zoom.configure({ maxZoom: 2 });
    expect(zoom.getZoom()).toBe(2);
  });

  it("stop() cancels the animation and the settle timer", () => {
    const { zoom, scheduler, timers } = make();
    zoom.zoomTo(2);
    zoom.zoomAround(1.1, { x: 0, y: 0 });
    zoom.stop();
    expect(scheduler.pending).toBe(0);
    expect(timers.pending).toBe(0);
  });

  it("a gesture interrupts an animation", () => {
    const { zoom, scheduler } = make();
    zoom.zoomTo(3);
    zoom.beginPinch({ x: 0, y: 0 });
    expect(scheduler.pending).toBe(0);
  });
});
