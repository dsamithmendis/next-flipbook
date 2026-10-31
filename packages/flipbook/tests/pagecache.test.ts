import { describe, expect, it } from "vitest";
import { PageCache } from "../src/core/cache/PageCache.js";

const make = (maxEntries: number, extra: { maxBytes?: number } = {}) => {
  const evicted: string[] = [];
  const cache = new PageCache<string>(
    { maxEntries, ...extra },
    { onEvict: (key) => evicted.push(key) },
  );
  return { cache, evicted };
};

describe("PageCache", () => {
  it("stores and reads values", () => {
    const { cache } = make(3);
    cache.set("a", "A", { position: 1 });
    expect(cache.get("a")).toBe("A");
    expect(cache.peek("a")).toBe("A");
    expect(cache.has("a")).toBe(true);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("evicts the entry farthest from the reader first", () => {
    const { cache, evicted } = make(3);
    cache.setFocus(10);
    cache.set("p10", "x", { position: 10 });
    cache.set("p11", "x", { position: 11 });
    cache.set("p3", "x", { position: 3 });
    cache.set("p12", "x", { position: 12 });
    expect(evicted).toEqual(["p3"]);
    expect(cache.keys().sort()).toEqual(["p10", "p11", "p12"]);
  });

  it("breaks distance ties by least recent use", () => {
    const { cache, evicted } = make(2);
    cache.setFocus(5);
    cache.set("before", "x", { position: 4 });
    cache.set("after", "x", { position: 6 });
    cache.get("before"); // "after" is now the older of two equally distant pages
    cache.set("here", "x", { position: 5 });
    expect(evicted).toEqual(["after"]);
  });

  it("never evicts protected entries, even when over budget", () => {
    const { cache, evicted } = make(1);
    cache.setFocus(1);
    cache.protect(["far", "near"]);
    cache.set("far", "x", { position: 100 });
    cache.set("near", "x", { position: 1 });
    expect(evicted).toEqual([]);
    expect(cache.size).toBe(2);
    cache.protect(["near"]);
    cache.setLimits({ maxEntries: 1 });
    expect(evicted).toEqual(["far"]);
  });

  it("respects canEvict", () => {
    const evicted: string[] = [];
    const cache = new PageCache<{ onScreen: boolean }>(
      { maxEntries: 1 },
      { onEvict: (key) => evicted.push(key), canEvict: (_key, value) => !value.onScreen },
    );
    cache.setFocus(1);
    cache.set("visible", { onScreen: true }, { position: 50 });
    cache.set("spare", { onScreen: false }, { position: 2 });
    expect(evicted).toEqual(["spare"]);
    expect(cache.has("visible")).toBe(true);
  });

  it("enforces a byte budget", () => {
    const { cache, evicted } = make(10, { maxBytes: 100 });
    cache.setFocus(1);
    cache.set("a", "x", { position: 1, bytes: 60 });
    cache.set("b", "x", { position: 2, bytes: 60 });
    expect(evicted).toEqual(["b"]);
    expect(cache.bytes).toBe(60);
  });

  it("replacing a key releases the old value and recounts bytes", () => {
    const { cache, evicted } = make(5);
    cache.set("a", "old", { position: 1, bytes: 10 });
    cache.set("a", "new", { position: 1, bytes: 30 });
    expect(evicted).toEqual(["a"]);
    expect(cache.get("a")).toBe("new");
    expect(cache.bytes).toBe(30);
  });

  it("clear and prefix deletion release everything they remove", () => {
    const { cache, evicted } = make(10);
    cache.set("s1:1:0.5", "x", { position: 1 });
    cache.set("s1:2:0.5", "x", { position: 2 });
    cache.set("s2:1:0.5", "x", { position: 1 });
    cache.deleteWithPrefix("s1:");
    expect(evicted.sort()).toEqual(["s1:1:0.5", "s1:2:0.5"]);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(evicted).toHaveLength(3);
  });
});
