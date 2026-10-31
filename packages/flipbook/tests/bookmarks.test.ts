import { describe, expect, it } from "vitest";
import { BookmarkStore, type BookmarkStorage } from "../src/core/bookmarks/BookmarkStore.js";

class MemoryStorage implements BookmarkStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("BookmarkStore", () => {
  it("adds, removes and toggles pages, keeping them sorted and unique", () => {
    const store = new BookmarkStore({ pageCount: 20 });
    expect(store.add(9)).toBe(true);
    expect(store.add(3)).toBe(true);
    expect(store.add(3)).toBe(false);
    expect(store.list()).toEqual([3, 9]);
    expect(store.toggle(5)).toBe(true);
    expect(store.toggle(5)).toBe(false);
    expect(store.remove(9)).toBe(true);
    expect(store.remove(9)).toBe(false);
    expect(store.list()).toEqual([3]);
    expect(store.has(3)).toBe(true);
    store.clear();
    expect(store.list()).toEqual([]);
  });

  it("rejects pages that are not pages", () => {
    const store = new BookmarkStore({ pageCount: 10 });
    for (const bad of [0, -1, 1.5, 11, Number.NaN, Infinity]) expect(store.add(bad)).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("accepts any positive page while the page count is still unknown", () => {
    const store = new BookmarkStore({ pageCount: 0 });
    expect(store.add(500)).toBe(true);
  });

  it("publishes a new immutable snapshot only when something changes", () => {
    const store = new BookmarkStore({ pageCount: 10 });
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.add(2);
    expect(store.getSnapshot()).not.toBe(first);
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    store.add(2); // already there
    store.remove(7); // not there
    expect(calls).toBe(1);
  });

  it("reports user changes to onChange with their origin", () => {
    const store = new BookmarkStore({ pageCount: 10 });
    const seen: Array<[readonly number[], string]> = [];
    store.onChange((pages, origin) => seen.push([pages, origin]));
    store.add(4);
    store.replace([1, 2]);
    expect(seen).toEqual([
      [[4], "user"],
      [[1, 2], "external"],
    ]);
  });

  it("replace() normalises and does nothing for an identical list", () => {
    const store = new BookmarkStore({ pageCount: 10 });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.replace([5, 2, 2, 99, -1]);
    expect(store.list()).toEqual([2, 5]);
    store.replace([2, 5]);
    expect(calls).toBe(1);
  });

  it("starts from initial values", () => {
    expect(new BookmarkStore({ pageCount: 10, initial: [7, 3, 7] }).list()).toEqual([3, 7]);
  });

  it("drops out-of-range bookmarks when the page count shrinks, without notifying as a user change", () => {
    const store = new BookmarkStore({ pageCount: 20, initial: [3, 15] });
    const origins: string[] = [];
    store.onChange((_pages, origin) => origins.push(origin));
    store.setPageCount(10);
    expect(store.list()).toEqual([3]);
    expect(origins).toEqual([]);
  });

  describe("persistence", () => {
    it("saves user changes and loads them back", () => {
      const storage = new MemoryStorage();
      const first = new BookmarkStore({ pageCount: 10 });
      first.useStorage(storage, "book");
      first.add(4);
      first.add(2);
      expect(JSON.parse(storage.data.get("book") ?? "{}")).toEqual({ v: 1, pages: [2, 4] });

      const second = new BookmarkStore({ pageCount: 10 });
      second.useStorage(storage, "book");
      second.hydrate();
      expect(second.list()).toEqual([2, 4]);
    });

    it("does not save external changes, so a controlled value does not rewrite storage", () => {
      const storage = new MemoryStorage();
      const store = new BookmarkStore({ pageCount: 10 });
      store.useStorage(storage, "book");
      store.replace([1, 2]);
      expect(storage.data.size).toBe(0);
    });

    it("keeps what is saved when a loading document has not reported its size yet", () => {
      const storage = new MemoryStorage();
      storage.setItem("book", JSON.stringify({ v: 1, pages: [3, 40] }));
      const store = new BookmarkStore({ pageCount: 0 });
      store.useStorage(storage, "book");
      store.hydrate();
      expect(store.list()).toEqual([3, 40]);
      store.setPageCount(10);
      expect(store.list()).toEqual([3]);
      expect((JSON.parse(storage.data.get("book") ?? "{}") as { pages?: number[] }).pages).toEqual([3, 40]);
    });

    it("survives broken, hostile or missing storage", () => {
      const store = new BookmarkStore({ pageCount: 10 });
      const broken: BookmarkStorage = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
      };
      store.useStorage(broken, "k");
      expect(() => store.hydrate()).not.toThrow();
      expect(() => store.add(3)).not.toThrow();
      expect(store.list()).toEqual([3]);

      for (const raw of ["not json", "null", '{"pages":"x"}', '{"pages":[1,"2",null,3.5,4]}']) {
        const s = new BookmarkStore({ pageCount: 10 });
        s.useStorage({ getItem: () => raw, setItem: () => undefined }, "k");
        expect(() => s.hydrate()).not.toThrow();
      }
      const filtered = new BookmarkStore({ pageCount: 10 });
      filtered.useStorage({ getItem: () => '{"pages":[1,"2",null,3.5,4]}', setItem: () => undefined }, "k");
      filtered.hydrate();
      expect(filtered.list()).toEqual([1, 4]);
    });

    it("does nothing without storage, a key or a saved value", () => {
      const store = new BookmarkStore({ pageCount: 10, initial: [2] });
      store.hydrate();
      store.useStorage(new MemoryStorage(), "empty");
      store.hydrate();
      expect(store.list()).toEqual([2]);
    });
  });
});
