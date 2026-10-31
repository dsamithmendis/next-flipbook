import { describe, expect, it } from "vitest";
import {
  GestureRecognizer,
  type GestureHandlers,
  type PointerInput,
} from "../src/core/interaction/GestureRecognizer.js";

interface Setup {
  direction?: "ltr" | "rtl";
  canTurn?: boolean;
  canZoom?: boolean;
  zoomed?: boolean;
  allowTurn?: boolean;
}

function make(setup: Setup = {}) {
  const calls: string[] = [];
  const log = {
    turnStarts: [] as string[],
    turnMoves: [] as Array<{ pull: number; forward: boolean }>,
    turnEnds: [] as Array<{ pull: number; velocity: number; forward: boolean; cancelled: boolean }>,
    pans: [] as Array<[number, number]>,
    pinchStarts: [] as Array<{ x: number; y: number }>,
    pinches: [] as Array<{ scale: number; x: number; y: number }>,
    pinchEnds: 0,
    doubleTaps: [] as Array<{ x: number; y: number }>,
  };
  const state = { zoomed: setup.zoomed ?? false };
  const handlers: GestureHandlers = {
    direction: () => setup.direction ?? "ltr",
    canTurn: () => setup.canTurn ?? true,
    canZoom: () => setup.canZoom ?? true,
    isZoomed: () => state.zoomed,
    onTurnStart: (direction) => {
      calls.push(`start:${direction}`);
      log.turnStarts.push(direction);
      return setup.allowTurn ?? true;
    },
    onTurnMove: (info) => log.turnMoves.push(info),
    onTurnEnd: (info) => log.turnEnds.push(info),
    onPan: (dx, dy) => log.pans.push([dx, dy]),
    onPinchStart: (center) => log.pinchStarts.push(center),
    onPinch: ({ scale, center }) => log.pinches.push({ scale, ...center }),
    onPinchEnd: () => {
      log.pinchEnds += 1;
    },
    onDoubleTap: (point) => log.doubleTaps.push(point),
  };
  const recognizer = new GestureRecognizer(handlers);
  const input = (
    id: number,
    x: number,
    y: number,
    time: number,
    kind: PointerInput["kind"] = "mouse",
    button = 0,
  ): PointerInput => ({ id, kind, x, y, time, button });
  return { recognizer, log, state, input, calls };
}

describe("turning with one pointer", () => {
  it("dragging left in an ltr book pulls the next page", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 480, 302, 10));
    recognizer.pointerMove(input(1, 400, 305, 30));
    recognizer.pointerUp(input(1, 350, 305, 40));
    expect(log.turnStarts).toEqual(["forward"]);
    expect(log.turnMoves.map((m) => m.pull)).toEqual([20, 100]);
    expect(log.turnMoves.every((m) => m.forward)).toBe(true);
    expect(log.turnEnds).toHaveLength(1);
    expect(log.turnEnds[0]).toMatchObject({ pull: 150, forward: true, cancelled: false });
    expect(log.turnEnds[0]?.velocity).toBeGreaterThan(1);
  });

  it("dragging right in an ltr book pulls the previous page", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 200, 300, 0));
    recognizer.pointerMove(input(1, 260, 300, 20));
    recognizer.pointerUp(input(1, 300, 300, 40));
    expect(log.turnStarts).toEqual(["backward"]);
    expect(log.turnEnds[0]).toMatchObject({ pull: 100, forward: false, cancelled: false });
  });

  it("mirrors both directions in a right-to-left book", () => {
    const { recognizer, log, input } = make({ direction: "rtl" });
    recognizer.pointerDown(input(1, 200, 300, 0));
    recognizer.pointerMove(input(1, 260, 300, 20));
    recognizer.pointerUp(input(1, 300, 300, 40));
    expect(log.turnStarts).toEqual(["forward"]);
    expect(log.turnEnds[0]?.pull).toBe(100);
  });

  it("does not start a turn below the slop distance, and treats the press as a tap", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 498, 300, 10));
    recognizer.pointerUp(input(1, 498, 300, 20));
    expect(log.turnStarts).toEqual([]);
    expect(recognizer.dragged).toBe(false);
  });

  it("touch needs a larger movement than a mouse", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0, "touch"));
    recognizer.pointerMove(input(1, 495, 300, 10, "touch"));
    expect(log.turnStarts).toEqual([]);
    recognizer.pointerMove(input(1, 488, 300, 20, "touch"));
    expect(log.turnStarts).toEqual(["forward"]);
  });

  it("leaves vertical drags alone so the page can scroll", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0, "touch"));
    recognizer.pointerMove(input(1, 495, 360, 20, "touch"));
    recognizer.pointerMove(input(1, 380, 420, 40, "touch"));
    recognizer.pointerUp(input(1, 300, 430, 60, "touch"));
    expect(log.turnStarts).toEqual([]);
    expect(log.turnMoves).toEqual([]);
    expect(recognizer.dragged).toBe(true);
  });

  it("allows a slightly diagonal drag but not a mostly vertical one", () => {
    const horizontal = make();
    horizontal.recognizer.pointerDown(horizontal.input(1, 500, 300, 0));
    horizontal.recognizer.pointerMove(horizontal.input(1, 450, 330, 10));
    expect(horizontal.log.turnStarts).toEqual(["forward"]);

    const vertical = make();
    vertical.recognizer.pointerDown(vertical.input(1, 500, 300, 0));
    vertical.recognizer.pointerMove(vertical.input(1, 470, 330, 10));
    expect(vertical.log.turnStarts).toEqual([]);
  });

  it("ignores the gesture when there is no page to turn to", () => {
    const { recognizer, log, input } = make({ allowTurn: false });
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 400, 300, 20));
    recognizer.pointerMove(input(1, 300, 300, 40));
    recognizer.pointerUp(input(1, 300, 300, 50));
    expect(log.turnMoves).toEqual([]);
    expect(log.turnEnds).toEqual([]);
  });

  it("does nothing when turning is disabled", () => {
    const { recognizer, log, input } = make({ canTurn: false });
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 300, 300, 20));
    expect(log.turnStarts).toEqual([]);
  });

  it("reads a pause before release as zero speed", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 450, 300, 10));
    recognizer.pointerMove(input(1, 380, 300, 20));
    recognizer.pointerUp(input(1, 380, 300, 520));
    expect(log.turnEnds[0]?.velocity).toBe(0);
  });

  it("reports a negative velocity when the pointer was moving back", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 380, 300, 20)); // a fast pull to the left...
    recognizer.pointerMove(input(1, 420, 300, 150)); // ...then back to the right
    recognizer.pointerMove(input(1, 440, 300, 170));
    recognizer.pointerUp(input(1, 460, 300, 190));
    // Only the last 100 ms count, and in that window the pointer was heading back.
    expect(log.turnEnds[0]?.velocity).toBeLessThan(0);
  });

  it("ignores the secondary mouse button", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0, "mouse", 2));
    recognizer.pointerMove(input(1, 300, 300, 20, "mouse", 2));
    expect(log.turnStarts).toEqual([]);
    expect(recognizer.active).toBe(false);
  });

  it("cancels the turn when the browser takes the pointer", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0, "touch"));
    recognizer.pointerMove(input(1, 440, 300, 20, "touch"));
    recognizer.pointerCancel(input(1, 440, 300, 30, "touch"));
    expect(log.turnEnds).toHaveLength(1);
    expect(log.turnEnds[0]?.cancelled).toBe(true);
    expect(recognizer.active).toBe(false);
  });

  it("is ready for a new gesture after one ends", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 400, 300, 20));
    recognizer.pointerUp(input(1, 400, 300, 30));
    recognizer.pointerDown(input(1, 500, 300, 1000));
    recognizer.pointerMove(input(1, 400, 300, 1020));
    expect(log.turnStarts).toEqual(["forward", "forward"]);
  });
});

describe("panning when zoomed", () => {
  it("pans instead of turning, in incremental steps that add up", () => {
    const { recognizer, log, input } = make({ zoomed: true });
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 480, 310, 10));
    recognizer.pointerMove(input(1, 440, 330, 20));
    recognizer.pointerUp(input(1, 440, 330, 30));
    expect(log.turnStarts).toEqual([]);
    const total = log.pans.reduce((sum, [dx, dy]) => [sum[0] + dx, sum[1] + dy], [0, 0]);
    expect(total).toEqual([-60, 30]);
  });

  it("does not pan when zoom is off, and falls back to turning", () => {
    const { recognizer, log, input } = make({ zoomed: true, canZoom: false });
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 440, 300, 10));
    expect(log.pans).toEqual([]);
  });
});

describe("pinching", () => {
  it("starts on the second finger and reports scale and centre", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 400, 300, 0, "touch"));
    recognizer.pointerDown(input(2, 600, 300, 5, "touch"));
    expect(log.pinchStarts).toEqual([{ x: 500, y: 300 }]);

    recognizer.pointerMove(input(2, 800, 300, 20, "touch"));
    expect(log.pinches.at(-1)).toEqual({ scale: 2, x: 600, y: 300 });
    recognizer.pointerMove(input(1, 500, 300, 30, "touch"));
    expect(log.pinches.at(-1)?.scale).toBeCloseTo(1.5);

    recognizer.pointerUp(input(2, 800, 300, 40, "touch"));
    expect(log.pinchEnds).toBe(1);
  });

  it("never turns a page after a pinch, even if one finger keeps moving", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 400, 300, 0, "touch"));
    recognizer.pointerDown(input(2, 600, 300, 5, "touch"));
    recognizer.pointerUp(input(2, 600, 300, 20, "touch"));
    recognizer.pointerMove(input(1, 200, 300, 40, "touch"));
    recognizer.pointerMove(input(1, 100, 300, 60, "touch"));
    expect(log.turnStarts).toEqual([]);
    expect(log.pans).toEqual([]);
  });

  it("a second finger cancels a turn that was in progress", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0, "touch"));
    recognizer.pointerMove(input(1, 420, 300, 20, "touch"));
    recognizer.pointerDown(input(2, 700, 300, 30, "touch"));
    expect(log.turnEnds).toHaveLength(1);
    expect(log.turnEnds[0]).toMatchObject({ cancelled: true, pull: 80 });
    expect(log.pinchStarts).toHaveLength(1);
  });

  it("ignores a second finger when zoom is off", () => {
    const { recognizer, log, input } = make({ canZoom: false });
    recognizer.pointerDown(input(1, 400, 300, 0, "touch"));
    recognizer.pointerDown(input(2, 600, 300, 5, "touch"));
    recognizer.pointerMove(input(2, 800, 300, 20, "touch"));
    expect(log.pinchStarts).toEqual([]);
    expect(log.pinches).toEqual([]);
  });

  it("ends the pinch if the browser cancels a finger", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 400, 300, 0, "touch"));
    recognizer.pointerDown(input(2, 600, 300, 5, "touch"));
    recognizer.pointerCancel(input(1, 400, 300, 20, "touch"));
    expect(log.pinchEnds).toBe(1);
  });
});

describe("double tap", () => {
  const tap = (r: GestureRecognizer, input: ReturnType<typeof make>["input"], x: number, time: number) => {
    r.pointerDown(input(1, x, 300, time));
    r.pointerUp(input(1, x, 300, time + 40));
  };

  it("fires on two quick taps close together", () => {
    const { recognizer, log, input } = make();
    tap(recognizer, input, 500, 0);
    tap(recognizer, input, 505, 200);
    expect(log.doubleTaps).toEqual([{ x: 505, y: 300 }]);
  });

  it("does not fire when the taps are slow or far apart", () => {
    const slow = make();
    tap(slow.recognizer, slow.input, 500, 0);
    tap(slow.recognizer, slow.input, 500, 700);
    expect(slow.log.doubleTaps).toEqual([]);

    const far = make();
    tap(far.recognizer, far.input, 100, 0);
    tap(far.recognizer, far.input, 600, 200);
    expect(far.log.doubleTaps).toEqual([]);
  });

  it("needs two new taps for the next double tap", () => {
    const { recognizer, log, input } = make();
    tap(recognizer, input, 500, 0);
    tap(recognizer, input, 500, 150);
    tap(recognizer, input, 500, 300);
    expect(log.doubleTaps).toHaveLength(1);
    tap(recognizer, input, 500, 450);
    expect(log.doubleTaps).toHaveLength(2);
  });

  it("a drag between two taps breaks the pair", () => {
    const { recognizer, log, input } = make();
    tap(recognizer, input, 500, 0);
    recognizer.pointerDown(input(1, 500, 300, 100));
    recognizer.pointerMove(input(1, 400, 300, 120));
    recognizer.pointerUp(input(1, 400, 300, 130));
    tap(recognizer, input, 500, 200);
    expect(log.doubleTaps).toEqual([]);
  });

  it("a long press is not a tap", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerUp(input(1, 500, 300, 900));
    tap(recognizer, input, 500, 1000);
    expect(log.doubleTaps).toEqual([]);
  });
});

describe("reset", () => {
  it("cancels a turn in progress and forgets all pointers", () => {
    const { recognizer, log, input } = make();
    recognizer.pointerDown(input(1, 500, 300, 0));
    recognizer.pointerMove(input(1, 400, 300, 20));
    recognizer.reset();
    expect(log.turnEnds[0]?.cancelled).toBe(true);
    expect(recognizer.active).toBe(false);
  });
});
