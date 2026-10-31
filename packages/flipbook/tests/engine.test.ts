import { describe, expect, it } from "vitest";
import { FlipBookEngine } from "../src/core/engine/FlipBookEngine.js";
import type { EngineOptions } from "../src/core/types.js";
import { FakeScheduler } from "./helpers/fakeScheduler.js";

function make(options: Partial<EngineOptions> = {}) {
  const scheduler = new FakeScheduler();
  const engine = new FlipBookEngine({
    pageCount: 10,
    view: "single",
    duration: 100,
    scheduler,
    ...options,
  });
  return { engine, scheduler };
}

describe("FlipBookEngine", () => {
  it("starts on the initial page", () => {
    expect(make().engine.getCurrentPage()).toBe(1);
    expect(make({ initialPage: 4 }).engine.getCurrentPage()).toBe(4);
    expect(make({ initialPage: 99 }).engine.getCurrentPage()).toBe(10);
  });

  it("animates a forward turn and reports events in order", () => {
    const { engine, scheduler } = make();
    const events: string[] = [];
    engine.on("turnstart", (e) => events.push(`start:${e.fromPage}->${e.toPage}`));
    engine.on("pagechange", (e) => events.push(`page:${e.page}`));
    engine.on("turnend", (e) => events.push(`end:${e.page}`));

    engine.next();
    expect(engine.isAnimating()).toBe(true);
    expect(engine.getCurrentPage()).toBe(2);
    expect(engine.getState().turn).toEqual({ from: 0, to: 1, forward: true });

    scheduler.advance(50);
    expect(engine.getTurnProgress()).toBeCloseTo(0.5);

    scheduler.advance(60);
    expect(engine.isAnimating()).toBe(false);
    expect(engine.getState().turn).toBeNull();
    expect(engine.getTurnProgress()).toBe(0);
    expect(events).toEqual(["start:1->2", "page:2", "end:2"]);
  });

  it("animates backward turns", () => {
    const { engine, scheduler } = make({ initialPage: 5 });
    engine.previous();
    expect(engine.getState().turn).toEqual({ from: 4, to: 3, forward: false });
    scheduler.advance(200);
    expect(engine.getCurrentPage()).toBe(4);
  });

  it("does nothing at the ends of the book", () => {
    const { engine, scheduler } = make();
    engine.previous();
    expect(engine.isAnimating()).toBe(false);
    engine.last();
    scheduler.advance(2000);
    engine.next();
    expect(engine.isAnimating()).toBe(false);
    expect(engine.getCurrentPage()).toBe(10);
  });

  it("queues navigation issued mid-turn and lands on the final target", () => {
    const { engine, scheduler } = make();
    engine.next();
    engine.next();
    engine.next();
    expect(engine.getCurrentPage()).toBe(2);
    scheduler.advance(150);
    // The queued target is reached with a second turn.
    expect(engine.isAnimating()).toBe(true);
    scheduler.advance(400);
    expect(engine.isAnimating()).toBe(false);
    expect(engine.getCurrentPage()).toBe(4);
  });

  it("ignores navigation mid-turn when configured to", () => {
    const { engine, scheduler } = make({ whileTurning: "ignore" });
    engine.next();
    engine.next();
    scheduler.advance(200);
    expect(engine.isAnimating()).toBe(false);
    expect(engine.getCurrentPage()).toBe(2);
  });

  it("goToPage jumps across spreads and lands on the right spread", () => {
    const { engine, scheduler } = make({ view: "double", cover: true, pageCount: 8 });
    engine.goToPage(5);
    scheduler.advance(1000);
    expect(engine.getState().visiblePages).toEqual([4, 5]);
    expect(engine.getCurrentPage()).toBe(4);
  });

  it("first and last reach both ends", () => {
    const { engine, scheduler } = make({ view: "double", cover: true, pageCount: 8 });
    engine.last();
    scheduler.advance(1000);
    expect(engine.getState().visiblePages).toEqual([8]);
    engine.first();
    scheduler.advance(1000);
    expect(engine.getState().visiblePages).toEqual([1]);
  });

  it("changes pages instantly, without scheduling frames, under reduced motion", () => {
    const { engine, scheduler } = make({ reducedMotion: true });
    const events: string[] = [];
    engine.on("turnstart", () => events.push("start"));
    engine.on("turnend", () => events.push("end"));
    engine.next();
    expect(scheduler.pending).toBe(0);
    expect(engine.isAnimating()).toBe(false);
    expect(engine.getCurrentPage()).toBe(2);
    expect(events).toEqual(["start", "end"]);
  });

  it("keeps the reader on the same page when the view changes", () => {
    const { engine } = make({ initialPage: 4 });
    const pages: number[] = [];
    engine.on("pagechange", (e) => pages.push(e.page));
    engine.configure({ view: "double" });
    expect(engine.getState().visiblePages).toEqual([3, 4]);
    expect(engine.getCurrentPage()).toBe(3);
    expect(pages).toEqual([3]);
    engine.configure({ view: "single" });
    expect(engine.getState().visiblePages).toEqual([3]);
  });

  it("ends a running turn when the layout changes", () => {
    const { engine, scheduler } = make();
    engine.next();
    engine.configure({ view: "double" });
    expect(engine.isAnimating()).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("does not notify subscribers for timing-only changes", () => {
    const { engine } = make();
    let calls = 0;
    engine.subscribe(() => {
      calls += 1;
    });
    engine.configure({ duration: 300, whileTurning: "ignore" });
    expect(calls).toBe(0);
  });

  it("clamps when the page count shrinks", () => {
    const { engine } = make({ initialPage: 9 });
    engine.configure({ pageCount: 5 });
    expect(engine.getCurrentPage()).toBe(5);
    expect(engine.getPageCount()).toBe(5);
  });

  it("handles an empty book", () => {
    const { engine } = make({ pageCount: 0 });
    expect(engine.getCurrentPage()).toBe(0);
    engine.next();
    engine.goToPage(3);
    expect(engine.isAnimating()).toBe(false);
  });

  it("publishes a new state object on change and a stable one otherwise", () => {
    const { engine } = make({ reducedMotion: true });
    const before = engine.getState();
    expect(engine.getState()).toBe(before);
    engine.next();
    expect(engine.getState()).not.toBe(before);
  });

  it("delivers frame progress to frame subscribers", () => {
    const { engine, scheduler } = make();
    const seen: number[] = [];
    engine.subscribeFrame((p) => seen.push(p));
    engine.next();
    scheduler.advance(50);
    scheduler.advance(100);
    expect(seen[0]).toBeCloseTo(0.5);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("stop() cancels the animation and keeps the destination", () => {
    const { engine, scheduler } = make();
    engine.next();
    engine.stop();
    expect(scheduler.pending).toBe(0);
    expect(engine.isAnimating()).toBe(false);
    expect(engine.getCurrentPage()).toBe(2);
  });

  it("destroy() leaves no frames scheduled and ignores later commands", () => {
    const { engine, scheduler } = make();
    let notified = 0;
    engine.subscribe(() => {
      notified += 1;
    });
    engine.next();
    expect(scheduler.pending).toBe(1);
    const before = notified;
    engine.destroy();
    expect(scheduler.pending).toBe(0);
    engine.next();
    engine.configure({ view: "double" });
    expect(notified).toBe(before);
    expect(engine.isAnimating()).toBe(false);
  });

  it("does not let a throwing handler break the engine", async () => {
    const { engine, scheduler } = make();
    engine.on("pagechange", () => {
      throw new Error("consumer bug");
    });
    const uncaught: unknown[] = [];
    const onError = (error: unknown): void => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onError);
    engine.next();
    scheduler.advance(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("uncaughtException", onError);
    expect(engine.getCurrentPage()).toBe(2);
    expect(engine.isAnimating()).toBe(false);
    expect(uncaught).toHaveLength(1);
  });
});

describe("FlipBookEngine: dragging", () => {
  it("lifts a page without moving the reader", () => {
    const { engine } = make();
    const events: string[] = [];
    engine.on("turnstart", (e) => events.push(`start:${e.fromPage}->${e.toPage}`));
    engine.on("pagechange", (e) => events.push(`page:${e.page}`));

    expect(engine.beginDrag("forward")).toBe(true);
    expect(engine.getState()).toMatchObject({
      status: "dragging",
      currentPage: 1,
      turn: { from: 0, to: 1, forward: true },
    });
    expect(engine.isAnimating()).toBe(true);
    expect(events).toEqual(["start:1->2"]);
  });

  it("follows the pointer and clamps progress", () => {
    const { engine } = make();
    const frames: number[] = [];
    engine.subscribeFrame((p) => frames.push(p));
    engine.beginDrag("forward");
    engine.dragTo(0.4);
    expect(engine.getTurnProgress()).toBeCloseTo(0.4);
    engine.dragTo(5);
    engine.dragTo(-2);
    expect(frames).toEqual([0.4, 1, 0]);
  });

  it("completing commits the new page at release and settles to fully turned", () => {
    const { engine, scheduler } = make();
    const events: string[] = [];
    const frames: number[] = [];
    engine.on("pagechange", (e) => events.push(`page:${e.page}`));
    engine.on("turnend", (e) => events.push(`end:${e.page}`));
    engine.subscribeFrame((p) => frames.push(p));

    engine.beginDrag("forward");
    engine.dragTo(0.6);
    engine.endDrag({ complete: true });
    expect(engine.getState().status).toBe("settling");
    expect(engine.getCurrentPage()).toBe(2);
    expect(events).toEqual(["page:2"]);

    scheduler.advance(1000);
    expect(engine.getState().status).toBe("idle");
    expect(frames[frames.length - 1]).toBe(1);
    expect(events).toEqual(["page:2", "end:2"]);
    expect(scheduler.pending).toBe(0);
  });

  it("cancelling springs back to where the turn began and never moves the reader", () => {
    const { engine, scheduler } = make();
    const events: string[] = [];
    const frames: number[] = [];
    engine.on("pagechange", (e) => events.push(`page:${e.page}`));
    engine.on("turnend", (e) => events.push(`end:${e.page}`));
    engine.subscribeFrame((p) => frames.push(p));

    engine.beginDrag("forward");
    engine.dragTo(0.3);
    engine.endDrag({ complete: false });
    expect(engine.getState().status).toBe("settling");
    expect(engine.getCurrentPage()).toBe(1);

    scheduler.advance(50);
    const midway = frames[frames.length - 1] as number;
    expect(midway).toBeLessThan(0.3);
    expect(midway).toBeGreaterThan(0);

    scheduler.advance(1000);
    expect(frames[frames.length - 1]).toBe(0);
    expect(engine.getState().status).toBe("idle");
    expect(engine.getCurrentPage()).toBe(1);
    expect(events).toEqual(["end:1"]);
  });

  it("drags backwards from a later page", () => {
    const { engine, scheduler } = make({ initialPage: 5 });
    expect(engine.beginDrag("backward")).toBe(true);
    expect(engine.getState().turn).toEqual({ from: 4, to: 3, forward: false });
    engine.dragTo(0.7);
    engine.endDrag({ complete: true });
    scheduler.advance(1000);
    expect(engine.getCurrentPage()).toBe(4);
  });

  it("refuses to drag past either end, during a turn, or after destroy", () => {
    const first = make();
    expect(first.engine.beginDrag("backward")).toBe(false);

    const last = make({ initialPage: 10 });
    expect(last.engine.beginDrag("forward")).toBe(false);

    const busy = make();
    busy.engine.next();
    expect(busy.engine.beginDrag("forward")).toBe(false);

    const gone = make();
    gone.engine.destroy();
    expect(gone.engine.beginDrag("forward")).toBe(false);
  });

  it("ignores dragTo and endDrag when nothing is held", () => {
    const { engine, scheduler } = make();
    engine.dragTo(0.5);
    engine.endDrag({ complete: true });
    expect(engine.getState().status).toBe("idle");
    expect(scheduler.pending).toBe(0);
  });

  it("finishes instantly under reduced motion", () => {
    const { engine, scheduler } = make({ reducedMotion: true });
    engine.beginDrag("forward");
    engine.dragTo(0.8);
    engine.endDrag({ complete: true });
    expect(scheduler.pending).toBe(0);
    expect(engine.getState().status).toBe("idle");
    expect(engine.getCurrentPage()).toBe(2);
  });

  it("finishes instantly when released exactly where it is going", () => {
    const { engine, scheduler } = make();
    engine.beginDrag("forward");
    engine.dragTo(1);
    engine.endDrag({ complete: true });
    expect(scheduler.pending).toBe(0);
    expect(engine.getState().status).toBe("idle");
  });

  it("runs navigation issued during a drag once the page is released", () => {
    const { engine, scheduler } = make();
    engine.beginDrag("forward");
    engine.next();
    engine.endDrag({ complete: false });
    scheduler.advance(1000);
    scheduler.advance(1000);
    expect(engine.getCurrentPage()).toBe(2);
    expect(engine.isAnimating()).toBe(false);
  });

  it("a layout change ends the drag cleanly", () => {
    const { engine, scheduler } = make();
    const ends: number[] = [];
    engine.on("turnend", (e) => ends.push(e.page));
    engine.beginDrag("forward");
    engine.configure({ view: "double" });
    expect(engine.getState().status).toBe("idle");
    expect(scheduler.pending).toBe(0);
    expect(ends).toHaveLength(1);
    engine.dragTo(0.5);
    engine.endDrag({ complete: true });
    expect(engine.getState().status).toBe("idle");
  });

  it("destroy() during a settle leaves nothing scheduled", () => {
    const { engine, scheduler } = make();
    engine.beginDrag("forward");
    engine.dragTo(0.5);
    engine.endDrag({ complete: true });
    expect(scheduler.pending).toBe(1);
    engine.destroy();
    expect(scheduler.pending).toBe(0);
  });
});


describe("FlipBookEngine: jumpToPage", () => {
  it("moves at once, with no animation, and reports the change", () => {
    const { engine, scheduler } = make({ view: "double", cover: true, pageCount: 10 });
    const events: string[] = [];
    engine.on("pagechange", (e) => events.push(`page:${e.page}`));
    engine.on("turnstart", () => events.push("start"));
    engine.jumpToPage(7);
    expect(scheduler.pending).toBe(0);
    expect(engine.isAnimating()).toBe(false);
    expect(engine.getState().visiblePages).toEqual([6, 7]);
    expect(events).toEqual(["page:6"]);
  });

  it("ends a running turn first", () => {
    const { engine, scheduler } = make();
    const ends: number[] = [];
    engine.on("turnend", (e) => ends.push(e.page));
    engine.next();
    engine.jumpToPage(8);
    expect(scheduler.pending).toBe(0);
    expect(engine.getCurrentPage()).toBe(8);
    expect(ends).toEqual([8]);
  });

  it("clamps, and ignores nonsense, an empty book and a destroyed engine", () => {
    const { engine } = make();
    engine.jumpToPage(99);
    expect(engine.getCurrentPage()).toBe(10);
    engine.jumpToPage(0);
    expect(engine.getCurrentPage()).toBe(1);
    engine.jumpToPage(Number.NaN);
    expect(engine.getCurrentPage()).toBe(1);
    expect(() => make({ pageCount: 0 }).engine.jumpToPage(3)).not.toThrow();
    const gone = make();
    gone.engine.destroy();
    gone.engine.jumpToPage(4);
    expect(gone.engine.getCurrentPage()).toBe(1);
  });

  it("opens a book that has no pages yet at that page once it gets some", () => {
    const { engine } = make({ pageCount: 0 });
    const events: number[] = [];
    engine.on("pagechange", (e) => events.push(e.page));
    engine.jumpToPage(4);
    engine.jumpToPage(Number.NaN);
    expect(engine.getCurrentPage()).toBe(0);
    engine.configure({ pageCount: 10 });
    expect(engine.getCurrentPage()).toBe(4);
    // Loading is not navigation.
    expect(events).toEqual([]);

    const clamped = make({ pageCount: 0 }).engine;
    clamped.jumpToPage(99);
    clamped.configure({ pageCount: 6 });
    expect(clamped.getCurrentPage()).toBe(6);
  });

  it("does nothing when already there", () => {
    const { engine } = make({ initialPage: 3 });
    const events: number[] = [];
    engine.on("pagechange", (e) => events.push(e.page));
    engine.jumpToPage(3);
    expect(events).toEqual([]);
  });
});
