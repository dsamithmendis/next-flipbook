import { describe, expect, it } from "vitest";
import {
  centeringShift,
  fitBook,
  parseAspectRatio,
  resolveView,
  slotLeft,
  spineSide,
} from "../src/core/layout/sizing.js";

describe("parseAspectRatio", () => {
  it("returns null for auto and invalid input", () => {
    expect(parseAspectRatio("auto")).toBeNull();
    expect(parseAspectRatio(0)).toBeNull();
    expect(parseAspectRatio(Number.NaN)).toBeNull();
    expect(parseAspectRatio("wide" as unknown as "4/3")).toBeNull();
  });

  it("parses numbers and ratios", () => {
    expect(parseAspectRatio(0.75)).toBe(0.75);
    expect(parseAspectRatio("4/3")).toBeCloseTo(4 / 3);
    expect(parseAspectRatio("16 / 9")).toBeCloseTo(16 / 9);
  });
});

describe("resolveView", () => {
  it("passes explicit modes through", () => {
    expect(resolveView("single", 2000, 640)).toBe("single");
    expect(resolveView("double", 200, 640)).toBe("double");
  });

  it("switches auto at the breakpoint", () => {
    expect(resolveView("auto", 639, 640)).toBe("single");
    expect(resolveView("auto", 640, 640)).toBe("double");
  });
});

describe("fitBook", () => {
  it("is limited by height in a wide container", () => {
    const layout = fitBook({ containerWidth: 2000, containerHeight: 400, pageAspect: 0.75, view: "double" });
    expect(layout.pageHeight).toBeLessThanOrEqual(400);
    expect(layout.pageWidth).toBe(300);
    expect(layout.bookWidth).toBe(600);
  });

  it("is limited by width in a narrow container", () => {
    const layout = fitBook({ containerWidth: 300, containerHeight: 2000, pageAspect: 0.75, view: "double" });
    expect(layout.pageWidth).toBe(150);
    expect(layout.bookWidth).toBe(300);
  });

  it("single view uses the full width", () => {
    const layout = fitBook({ containerWidth: 300, containerHeight: 2000, pageAspect: 0.75, view: "single" });
    expect(layout.pageWidth).toBe(300);
    expect(layout.bookWidth).toBe(300);
  });

  it("never returns negative or NaN sizes", () => {
    const layout = fitBook({ containerWidth: -10, containerHeight: 0, pageAspect: Number.NaN, view: "double" });
    expect(layout).toEqual({ pageWidth: 0, pageHeight: 0, bookWidth: 0 });
  });
});

describe("centeringShift", () => {
  it("centres a lone front cover", () => {
    expect(centeringShift({ verso: null, recto: 1 }, "double", "ltr")).toBe(-0.5);
    expect(centeringShift({ verso: null, recto: 1 }, "double", "rtl")).toBe(0.5);
  });

  it("centres a lone back cover", () => {
    expect(centeringShift({ verso: 6, recto: null }, "double", "ltr")).toBe(0.5);
    expect(centeringShift({ verso: 6, recto: null }, "double", "rtl")).toBe(-0.5);
  });

  it("does not shift full spreads or single view", () => {
    expect(centeringShift({ verso: 2, recto: 3 }, "double", "ltr")).toBe(0);
    expect(centeringShift({ verso: null, recto: 3 }, "single", "ltr")).toBe(0);
  });
});

describe("slots", () => {
  it("places recto on the right in ltr and on the left in rtl", () => {
    expect(slotLeft("recto", "double", "ltr", 300)).toBe(300);
    expect(slotLeft("verso", "double", "ltr", 300)).toBe(0);
    expect(slotLeft("recto", "double", "rtl", 300)).toBe(0);
    expect(slotLeft("verso", "double", "rtl", 300)).toBe(300);
  });

  it("parks the single-view verso outside the box", () => {
    expect(slotLeft("recto", "single", "ltr", 300)).toBe(0);
    expect(slotLeft("verso", "single", "ltr", 300)).toBe(-300);
    expect(slotLeft("verso", "single", "rtl", 300)).toBe(300);
  });

  it("binds pages at the spine", () => {
    expect(spineSide("recto", "ltr")).toBe("left");
    expect(spineSide("verso", "ltr")).toBe("right");
    expect(spineSide("recto", "rtl")).toBe("right");
    expect(spineSide("verso", "rtl")).toBe("left");
  });
});
