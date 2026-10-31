import { describe, expect, it, vi } from "vitest";
import { SearchController, type SearchSource } from "../src/core/search/SearchController.js";
import type { PageText } from "../src/core/search/text.js";

/** One run per page, spanning the page, so a match's rectangle can be predicted. */
const pageText = (text: string): PageText => ({
  text,
  runs: [{ start: 0, end: text.length, rect: { x: 0, y: 0, width: 1, height: 0.1 }, horizontal: true }],
});

function source(texts: Array<string | null>, hooks: { onGet?: (position: number, signal: AbortSignal) => Promise<void> | void } = {}): SearchSource {
  return {
    total: texts.length,
    async getText(position, signal) {
      await hooks.onGet?.(position, signal);
      const text = texts[position - 1];
      return text === null || text === undefined ? null : pageText(text);
    },
  };
}

const make = (texts: Array<string | null>, options?: ConstructorParameters<typeof SearchController>[0]) => {
  const controller = new SearchController(options);
  controller.setSource(source(texts));
  return controller;
};

describe("SearchController", () => {
  it("finds matches across pages, in page order, with context", async () => {
    const search = make(["no luck here", "the Needle is here", null, "needle and NEEDLE"]);
    const done = await search.search("needle");
    expect(done.status).toBe("done");
    expect(done.results.map((r) => r.position)).toEqual([2, 4, 4]);
    expect(done.results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(done.results[0]).toMatchObject({ before: "the ", match: "Needle", after: " is here" });
    expect(done).toMatchObject({ scanned: 4, total: 4, truncated: false, query: "needle" });
  });

  it("selects the first result at or after the page being read, else wraps to the first", async () => {
    const search = make(["x needle", "y", "z needle", "w"]);
    expect((await search.search("needle", { startPosition: 2 })).current).toBe(1);
    expect((await search.search("needle", { startPosition: 4 })).current).toBe(0);
    expect((await search.search("needle")).current).toBe(0);
  });

  it("reports progress while scanning, and the first results before it finishes", async () => {
    const search = make(Array.from({ length: 30 }, (_, i) => (i === 2 ? "needle" : "nothing")));
    const seen: Array<[string, number, number]> = [];
    search.subscribe(() => {
      const s = search.getSnapshot();
      seen.push([s.status, s.results.length, s.scanned]);
    });
    await search.search("needle");
    expect(seen[0]).toEqual(["searching", 0, 0]);
    expect(seen.some(([status, results]) => status === "searching" && results === 1)).toBe(true);
    expect(seen[seen.length - 1]).toEqual(["done", 1, 30]);
    // Not one notification per page.
    expect(seen.length).toBeLessThan(15);
  });

  it("stops at maxResults and says so", async () => {
    const search = make(["aa aa aa aa", "aa aa aa aa"], { maxResults: 5 });
    const done = await search.search("aa", { startPosition: 1 });
    expect(done.results).toHaveLength(5);
    expect(done.truncated).toBe(true);
    expect(done.status).toBe("done");
  });

  it("does not search for a query that is too short", async () => {
    const search = make(["abc"]);
    expect((await search.search("a")).status).toBe("idle");
    expect((await search.search("   ")).results).toEqual([]);
    const short = new SearchController({ minLength: 1 });
    short.setSource(source(["abc"]));
    expect((await short.search("a")).results).toHaveLength(1);
  });

  it("does nothing without a source", async () => {
    const search = new SearchController();
    expect((await search.search("needle")).status).toBe("idle");
  });

  it("a newer search cancels the one in progress", async () => {
    const signals: AbortSignal[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const search = new SearchController();
    search.setSource(
      source(["alpha beta", "alpha beta", "alpha beta"], {
        onGet: async (position, signal) => {
          signals.push(signal);
          if (position === 1) await gate;
        },
      }),
    );
    const first = search.search("alpha");
    await Promise.resolve();
    const second = search.search("beta");
    release();
    await Promise.all([first, second]);
    expect(signals[0]?.aborted).toBe(true);
    expect(search.getSnapshot().query).toBe("beta");
    expect(search.getSnapshot().results.every((r) => r.match === "beta")).toBe(true);
    expect(search.getSnapshot().status).toBe("done");
  });

  it("skips a page whose text cannot be read", async () => {
    const search = new SearchController();
    search.setSource({
      total: 3,
      async getText(position) {
        if (position === 2) throw new Error("corrupt page");
        return pageText("needle");
      },
    });
    const done = await search.search("needle");
    expect(done.results.map((r) => r.position)).toEqual([1, 3]);
  });

  it("steps through results and wraps", async () => {
    const search = make(["x needle", "needle y", "needle"]);
    await search.search("needle");
    expect(search.getSnapshot().current).toBe(0);
    search.next();
    search.next();
    expect(search.getSnapshot().current).toBe(2);
    search.next();
    expect(search.getSnapshot().current).toBe(0);
    search.previous();
    expect(search.getSnapshot().current).toBe(2);
    search.goTo(1);
    expect(search.getSnapshot().current).toBe(1);
    search.goTo(99);
    expect(search.getSnapshot().current).toBe(1);
  });

  it("announces each change of selected result, including the first", async () => {
    const search = make(["x needle", "needle y"]);
    const heard: Array<[number, number]> = [];
    search.onCurrent((result) => heard.push([result.index, result.position]));
    await search.search("needle");
    search.next();
    search.next();
    expect(heard).toEqual([[0, 1], [1, 2], [0, 1]]);
  });

  it("groups highlights by page and marks the selected result", async () => {
    const search = make(["needle", "none", "needle needle"]);
    await search.search("needle");
    search.goTo(1);
    const byPage = search.getHighlights();
    expect([...byPage.keys()]).toEqual([1, 3]);
    expect(byPage.get(1)?.map((h) => h.current)).toEqual([false]);
    expect(byPage.get(3)?.map((h) => h.current)).toEqual([true, false]);
    expect(byPage.get(3)?.[0]?.rect.width).toBeCloseTo(6 / 13);
    // The same object until something changes.
    expect(search.getHighlights()).toBe(byPage);
    search.next();
    expect(search.getHighlights()).not.toBe(byPage);
  });

  it("clear() cancels and forgets", async () => {
    const search = make(["needle"]);
    await search.search("needle");
    search.clear();
    expect(search.getSnapshot()).toMatchObject({ query: "", status: "idle", results: [], current: -1 });
    expect(search.getHighlights().size).toBe(0);
    search.next();
    expect(search.getSnapshot().current).toBe(-1);
  });

  it("clear() aborts a search that is still running", async () => {
    let signal: AbortSignal | undefined;
    const search = new SearchController();
    search.setSource(source(["needle", "needle"], { onGet: async (_p, s) => { signal = s; await new Promise((r) => setTimeout(r, 5)); } }));
    const running = search.search("needle");
    await Promise.resolve();
    search.clear();
    await running;
    expect(signal?.aborted).toBe(true);
    expect(search.getSnapshot().status).toBe("idle");
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const search = make(["needle"]);
    const listener = vi.fn();
    const off = search.subscribe(listener);
    await search.search("needle");
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    off();
    search.next();
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});
