import { describe, expect, it } from "vitest";
import { UiStore } from "../src/core/ui/UiStore.js";
import { FakeTimers } from "./helpers/fakeTimers.js";

function make(initial: ConstructorParameters<typeof UiStore>[0] = {}) {
  const timers = new FakeTimers();
  const ui = new UiStore(initial, { setTimer: timers.set, clearTimer: timers.clear, noticeMs: 1000 });
  return { ui, timers };
}

describe("UiStore", () => {
  it("opens, closes and toggles panels", () => {
    const { ui } = make();
    expect(ui.getSnapshot().panel).toBeNull();
    ui.setPanel("thumbnails");
    expect(ui.getSnapshot().panel).toBe("thumbnails");
    ui.togglePanel("thumbnails");
    expect(ui.getSnapshot().panel).toBeNull();
    ui.togglePanel("bookmarks");
    ui.togglePanel("thumbnails");
    expect(ui.getSnapshot().panel).toBe("thumbnails");
  });

  it("can start with a panel open", () => {
    expect(make({ panel: "bookmarks" }).ui.getSnapshot().panel).toBe("bookmarks");
  });

  it("shows a notice that clears itself", () => {
    const { ui, timers } = make();
    ui.notify("Link copied");
    expect(ui.getSnapshot().notice?.text).toBe("Link copied");
    timers.advance(999);
    expect(ui.getSnapshot().notice).not.toBeNull();
    timers.advance(2);
    expect(ui.getSnapshot().notice).toBeNull();
  });

  it("a newer notice replaces the old one and restarts the timer", () => {
    const { ui, timers } = make();
    ui.notify("one");
    timers.advance(800);
    ui.notify("two");
    timers.advance(800);
    expect(ui.getSnapshot().notice?.text).toBe("two");
    timers.advance(300);
    expect(ui.getSnapshot().notice).toBeNull();
  });

  it("gives repeated text a new id so it can be announced again", () => {
    const { ui } = make();
    ui.notify("Saved");
    const first = ui.getSnapshot().notice?.id;
    ui.notify("Saved");
    expect(ui.getSnapshot().notice?.id).not.toBe(first);
  });

  it("keeps a notice with ms 0 until it is cleared", () => {
    const { ui, timers } = make();
    ui.notify("Preparing…", 0);
    timers.advance(60_000);
    expect(ui.getSnapshot().notice?.text).toBe("Preparing…");
    ui.clearNotice();
    expect(ui.getSnapshot().notice).toBeNull();
  });

  it("tracks print progress and fullscreen without notifying when nothing changes", () => {
    const { ui } = make();
    let calls = 0;
    ui.subscribe(() => {
      calls += 1;
    });
    ui.setPrinting({ done: 1, total: 4 });
    ui.setPrinting({ done: 1, total: 4 });
    ui.setPrinting({ done: 2, total: 4 });
    ui.setFullscreen("native");
    ui.setFullscreen("native");
    ui.setPanel(null);
    expect(calls).toBe(3);
    expect(ui.getSnapshot()).toMatchObject({ printing: { done: 2, total: 4 }, fullscreen: "native" });
  });

  it("stop() cancels the notice timer", () => {
    const { ui, timers } = make();
    ui.notify("hi");
    ui.stop();
    expect(timers.pending).toBe(0);
  });

  it("tracks the open hotspot and the new panels", () => {
    const { ui } = make();
    let calls = 0;
    ui.subscribe(() => {
      calls += 1;
    });
    ui.setHotspot("p1");
    ui.setHotspot("p1");
    expect(ui.getSnapshot().hotspot).toBe("p1");
    ui.setHotspot(null);
    ui.togglePanel("search");
    expect(ui.getSnapshot().panel).toBe("search");
    ui.togglePanel("outline");
    expect(ui.getSnapshot().panel).toBe("outline");
    expect(calls).toBe(4);
  });
});
