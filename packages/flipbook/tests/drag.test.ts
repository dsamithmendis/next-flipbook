import { describe, expect, it } from "vitest";
import {
  FLICK_VELOCITY,
  dragProgress,
  dragTravel,
  shouldCompleteTurn,
} from "../src/core/interaction/drag.js";

describe("dragProgress", () => {
  const pw = 300;

  it("starts at 0, is half done when edge-on, and ends at 1 (forward)", () => {
    expect(dragProgress(0, pw, true)).toBeCloseTo(0);
    expect(dragProgress(pw, pw, true)).toBeCloseTo(0.5);
    expect(dragProgress(2 * pw, pw, true)).toBeCloseTo(1);
  });

  it("uses the same convention for backward turns", () => {
    expect(dragProgress(0, pw, false)).toBeCloseTo(0);
    expect(dragProgress(pw, pw, false)).toBeCloseTo(0.5);
    expect(dragProgress(2 * pw, pw, false)).toBeCloseTo(1);
  });

  it("never decreases as the pointer pulls further", () => {
    for (const forward of [true, false]) {
      let previous = -1;
      for (let pull = 0; pull <= 2 * pw; pull += 10) {
        const value = dragProgress(pull, pw, forward);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        previous = value;
      }
    }
  });

  it("ignores movement against the turn and clamps overshoot", () => {
    expect(dragProgress(-80, pw, true)).toBe(0);
    expect(dragProgress(9999, pw, true)).toBeCloseTo(1);
  });

  it("makes a page follow the pointer in double view: edge moves with the finger", () => {
    // After pulling a quarter page, the free edge is a quarter page in: cos(theta) = 0.75.
    const progress = dragProgress(pw * 0.25, pw, true, dragTravel("double", pw));
    expect(Math.cos(progress * Math.PI)).toBeCloseTo(0.75);
  });

  it("needs a shorter pull in single view", () => {
    const double = dragProgress(pw * 0.5, pw, true, dragTravel("double", pw));
    const single = dragProgress(pw * 0.5, pw, true, dragTravel("single", pw));
    expect(single).toBeGreaterThan(double);
    expect(dragProgress(pw, pw, true, dragTravel("single", pw))).toBeCloseTo(1);
  });

  it("is safe with degenerate sizes", () => {
    expect(dragProgress(100, 0, true)).toBe(0);
    expect(dragProgress(100, 300, true, 0)).toBe(0);
  });
});

describe("shouldCompleteTurn", () => {
  it("completes past halfway when nearly still", () => {
    expect(shouldCompleteTurn({ progress: 0.6, velocity: 0 })).toBe(true);
    expect(shouldCompleteTurn({ progress: 0.4, velocity: 0 })).toBe(false);
  });

  it("completes on a flick in the turn direction even from a short pull", () => {
    expect(shouldCompleteTurn({ progress: 0.1, velocity: FLICK_VELOCITY + 0.1 })).toBe(true);
  });

  it("cancels on a flick back even from a long pull", () => {
    expect(shouldCompleteTurn({ progress: 0.9, velocity: -(FLICK_VELOCITY + 0.1) })).toBe(false);
  });

  it("always cancels when the gesture was cancelled", () => {
    expect(shouldCompleteTurn({ progress: 0.9, velocity: 2, cancelled: true })).toBe(false);
  });
});
