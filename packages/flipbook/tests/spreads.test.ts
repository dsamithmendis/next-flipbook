import { describe, expect, it } from "vitest";
import {
  getSpread,
  pageToSpreadIndex,
  spreadCount,
  type LayoutOptions,
} from "../src/core/layout/spreads.js";

describe("spreads", () => {
  it("single view shows one recto page per spread", () => {
    const options: LayoutOptions = { pageCount: 3, view: "single", cover: false };
    expect(spreadCount(options)).toBe(3);
    expect(getSpread(0, options)).toEqual({ verso: null, recto: 1 });
    expect(getSpread(2, options)).toEqual({ verso: null, recto: 3 });
  });

  it("double view without cover pairs pages", () => {
    const options: LayoutOptions = { pageCount: 5, view: "double", cover: false };
    expect(spreadCount(options)).toBe(3);
    expect(getSpread(0, options)).toEqual({ verso: 1, recto: 2 });
    expect(getSpread(1, options)).toEqual({ verso: 3, recto: 4 });
    expect(getSpread(2, options)).toEqual({ verso: 5, recto: null });
  });

  it("cover with an even page count has a lone front and back cover", () => {
    const options: LayoutOptions = { pageCount: 6, view: "double", cover: true };
    expect(spreadCount(options)).toBe(4);
    expect(getSpread(0, options)).toEqual({ verso: null, recto: 1 });
    expect(getSpread(1, options)).toEqual({ verso: 2, recto: 3 });
    expect(getSpread(2, options)).toEqual({ verso: 4, recto: 5 });
    expect(getSpread(3, options)).toEqual({ verso: 6, recto: null });
  });

  it("cover with an odd page count ends on a full spread", () => {
    const options: LayoutOptions = { pageCount: 5, view: "double", cover: true };
    expect(spreadCount(options)).toBe(3);
    expect(getSpread(2, options)).toEqual({ verso: 4, recto: 5 });
  });

  it("handles empty and single-page books", () => {
    expect(spreadCount({ pageCount: 0, view: "double", cover: true })).toBe(0);
    expect(getSpread(0, { pageCount: 0, view: "double", cover: true })).toEqual({
      verso: null,
      recto: null,
    });
    expect(spreadCount({ pageCount: 1, view: "double", cover: true })).toBe(1);
  });

  it("clamps out-of-range spread indices", () => {
    const options: LayoutOptions = { pageCount: 4, view: "single", cover: false };
    expect(getSpread(-5, options)).toEqual({ verso: null, recto: 1 });
    expect(getSpread(99, options)).toEqual({ verso: null, recto: 4 });
  });

  it("pageToSpreadIndex finds the spread containing every page", () => {
    for (let pageCount = 1; pageCount <= 12; pageCount += 1) {
      for (const view of ["single", "double"] as const) {
        for (const cover of [false, true]) {
          const options: LayoutOptions = { pageCount, view, cover };
          for (let page = 1; page <= pageCount; page += 1) {
            const spread = getSpread(pageToSpreadIndex(page, options), options);
            expect([spread.verso, spread.recto]).toContain(page);
          }
        }
      }
    }
  });

  it("pageToSpreadIndex clamps to the valid range", () => {
    const options: LayoutOptions = { pageCount: 10, view: "double", cover: true };
    expect(pageToSpreadIndex(0, options)).toBe(0);
    expect(pageToSpreadIndex(999, options)).toBe(spreadCount(options) - 1);
  });
});
