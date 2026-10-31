import { describe, expect, it } from "vitest";
import {
  buildPageText,
  compileQuery,
  findMatches,
  type PageText,
  type RawTextItem,
  type RectMapper,
} from "../src/core/search/text.js";

// Treat PDF space as the page: x and y are used as they are, height as given.
const identity: RectMapper = (x, y, width, height) => ({ x, y, width, height });

const item = (str: string, x: number, y: number, width: number, extra: Partial<RawTextItem> = {}): RawTextItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
  ...extra,
});

describe("buildPageText", () => {
  it("joins items and remembers where each came from", () => {
    const page = buildPageText([item("Hello", 0, 100, 50), item(" World", 50, 100, 60)], identity);
    expect(page.text).toBe("Hello World");
    expect(page.runs.map((r) => [r.start, r.end])).toEqual([[0, 5], [5, 11]]);
    expect(page.runs[1]?.rect).toEqual({ x: 50, y: 100, width: 60, height: 10 });
  });

  it("adds a space where the next item starts clearly after the last one", () => {
    const page = buildPageText([item("Hello", 0, 100, 50), item("World", 60, 100, 50)], identity);
    expect(page.text).toBe("Hello World");
    // The added space belongs to no run.
    expect(page.runs.map((r) => [r.start, r.end])).toEqual([[0, 5], [6, 11]]);
  });

  it("does not split a word that the PDF split mid-way", () => {
    const page = buildPageText([item("Hel", 0, 100, 30), item("lo", 30.2, 100, 20)], identity);
    expect(page.text).toBe("Hello");
  });

  it("starts a new line with a space", () => {
    const page = buildPageText([item("First", 0, 100, 50), item("Second", 0, 80, 60)], identity);
    expect(page.text).toBe("First Second");
  });

  it("honours end-of-line markers", () => {
    const page = buildPageText([item("one", 0, 100, 30, { hasEOL: true }), item("two", 0, 100, 30)], identity);
    expect(page.text).toBe("one two");
  });

  it("ignores marked-content entries and empty strings", () => {
    const page = buildPageText(
      [{ type: "beginMarkedContent" } as unknown as RawTextItem, item("", 0, 0, 0), item("Text", 0, 100, 40)],
      identity,
    );
    expect(page.text).toBe("Text");
    expect(page.runs).toHaveLength(1);
  });

  it("flags rotated text", () => {
    const page = buildPageText([{ str: "up", transform: [0, 10, -10, 0, 5, 5], width: 20, height: 10 }], identity);
    expect(page.runs[0]?.horizontal).toBe(false);
  });
});

describe("compileQuery", () => {
  it("is null for nothing", () => {
    expect(compileQuery("")).toBeNull();
    expect(compileQuery("   ")).toBeNull();
  });

  it("treats regular-expression characters literally", () => {
    const regex = compileQuery("a.b (c)+") as RegExp;
    expect(regex.test("a.b (c)+")).toBe(true);
    regex.lastIndex = 0;
    expect(regex.test("axb cc")).toBe(false);
  });
});

const page = (text: string, runs: PageText["runs"] = []): PageText => ({ text, runs });

describe("findMatches", () => {
  it("finds every occurrence regardless of case, including accented letters", () => {
    const matches = findMatches(page("Café cafÉ CAFÉ"), compileQuery("café") as RegExp);
    expect(matches.map((m) => m.match)).toEqual(["Café", "cafÉ", "CAFÉ"]);
  });

  it("lets any whitespace in the query match any whitespace in the text", () => {
    const matches = findMatches(page("the quick\n  brown fox"), compileQuery("quick brown") as RegExp);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.match).toBe("quick brown");
  });

  it("locates a match inside a run by character position", () => {
    const text = buildPageText([item("Hello World", 100, 200, 110)], identity);
    const [match] = findMatches(text, compileQuery("World") as RegExp);
    expect(match?.rects).toHaveLength(1);
    expect(match?.rects[0]?.x).toBeCloseTo(100 + (110 * 6) / 11);
    expect(match?.rects[0]?.width).toBeCloseTo((110 * 5) / 11);
    expect(match?.rects[0]).toMatchObject({ y: 200, height: 10 });
  });

  it("gives one rectangle per run when a match spans several", () => {
    const text = buildPageText([item("Hello", 0, 100, 50), item("World", 60, 100, 50)], identity);
    const [match] = findMatches(text, compileQuery("lo wor") as RegExp);
    expect(match?.rects).toHaveLength(2);
    expect(match?.rects[0]?.x).toBeCloseTo(30);
    expect(match?.rects[1]?.x).toBeCloseTo(60);
    expect(match?.rects[1]?.width).toBeCloseTo(30);
  });

  it("uses the whole run for rotated text", () => {
    const text = buildPageText([{ str: "vertical", transform: [0, 10, -10, 0, 5, 5], width: 80, height: 10 }], identity);
    const [match] = findMatches(text, compileQuery("tic") as RegExp);
    expect(match?.rects[0]).toEqual({ x: 5, y: 5, width: 80, height: 10 });
  });

  it("gives context with ellipses where the text was cut", () => {
    const long = `${"a ".repeat(40)}needle${" b".repeat(40)}`;
    const [match] = findMatches(page(long), compileQuery("needle") as RegExp, { snippet: 10 });
    expect(match?.before.startsWith("…")).toBe(true);
    expect(match?.after.endsWith("…")).toBe(true);
    expect(match?.before.length).toBeLessThanOrEqual(12);
    const [short] = findMatches(page("a needle b"), compileQuery("needle") as RegExp, { snippet: 40 });
    expect(short).toMatchObject({ before: "a ", match: "needle", after: " b" });
  });

  it("collapses whitespace in snippets", () => {
    const [match] = findMatches(page("one\n\n  two needle   three"), compileQuery("needle") as RegExp);
    expect(match?.before).toBe("one two ");
    expect(match?.after).toBe(" three");
  });

  it("respects a limit and can be reused", () => {
    const regex = compileQuery("a") as RegExp;
    expect(findMatches(page("aaaa"), regex, { limit: 2 })).toHaveLength(2);
    expect(findMatches(page("aaaa"), regex)).toHaveLength(4);
  });

  it("finds nothing when there is nothing", () => {
    expect(findMatches(page(""), compileQuery("x") as RegExp)).toEqual([]);
    expect(findMatches(page("abc"), compileQuery("x") as RegExp)).toEqual([]);
  });
});
