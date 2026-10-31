import { describe, expect, it } from "vitest";
import { computeTurnVisuals } from "../src/core/animation/turn.js";

const base = { direction: "ltr", shadowIntensity: 0.5, fromShift: 0, toShift: 0 } as const;

describe("computeTurnVisuals", () => {
  it("a forward turn swings the leaf from 0 to 180 degrees", () => {
    expect(computeTurnVisuals({ ...base, forward: true, progress: 0 }).angle).toBe(0);
    expect(computeTurnVisuals({ ...base, forward: true, progress: 0.5 }).angle).toBe(90);
    expect(computeTurnVisuals({ ...base, forward: true, progress: 1 }).angle).toBe(180);
  });

  it("a backward turn runs the same swing in reverse", () => {
    expect(computeTurnVisuals({ ...base, forward: false, progress: 0 }).angle).toBe(180);
    expect(computeTurnVisuals({ ...base, forward: false, progress: 1 }).angle).toBe(0);
  });

  it("mirrors the rotation for right-to-left books", () => {
    const ltr = computeTurnVisuals({ ...base, forward: true, progress: 0.5 });
    const rtl = computeTurnVisuals({ ...base, forward: true, progress: 0.5, direction: "rtl" });
    expect(ltr.rotateY).toBe(-90);
    expect(rtl.rotateY).toBe(90);
  });

  it("keeps every shade within 0..1", () => {
    for (let step = 0; step <= 20; step += 1) {
      const v = computeTurnVisuals({ ...base, shadowIntensity: 1, forward: true, progress: step / 20 });
      for (const shade of [v.frontShade, v.backShade, v.revealShade, v.castShade]) {
        expect(shade).toBeGreaterThanOrEqual(0);
        expect(shade).toBeLessThanOrEqual(1);
      }
    }
  });

  it("turns all shading off at zero intensity", () => {
    const v = computeTurnVisuals({ ...base, shadowIntensity: 0, forward: true, progress: 0.4 });
    expect([v.frontShade, v.backShade, v.revealShade, v.castShade]).toEqual([0, 0, 0, 0]);
  });

  it("interpolates the centring shift", () => {
    const v = computeTurnVisuals({ ...base, forward: true, progress: 0.5, fromShift: -0.5, toShift: 0 });
    expect(v.shift).toBeCloseTo(-0.25);
  });

  it("clamps progress outside 0..1", () => {
    expect(computeTurnVisuals({ ...base, forward: true, progress: 2 }).angle).toBe(180);
    expect(computeTurnVisuals({ ...base, forward: true, progress: -1 }).angle).toBe(0);
  });
});
