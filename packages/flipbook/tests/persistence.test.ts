import { describe, expect, it } from "vitest";
import { readReadingState, writeReadingState, type StorageLike } from "../src/core/persistence/readingState.js";

class Memory implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("reading state", () => {
  it("round-trips page and zoom", () => {
    const storage = new Memory();
    writeReadingState(storage, "k", { page: 12, zoom: 1.5 });
    expect(readReadingState(storage, "k")).toEqual({ page: 12, zoom: 1.5 });
  });

  it("merges updates over what is saved", () => {
    const storage = new Memory();
    writeReadingState(storage, "k", { page: 3 });
    writeReadingState(storage, "k", { zoom: 2 });
    writeReadingState(storage, "k", { page: 4 });
    expect(readReadingState(storage, "k")).toEqual({ page: 4, zoom: 2 });
  });

  it("drops values that are not sensible", () => {
    const storage = new Memory();
    storage.setItem("k", JSON.stringify({ page: 0, zoom: 99 }));
    expect(readReadingState(storage, "k")).toEqual({});
    storage.setItem("k", JSON.stringify({ page: 2.5, zoom: "big" }));
    expect(readReadingState(storage, "k")).toEqual({});
    storage.setItem("k", JSON.stringify({ page: 7, zoom: 0.5 }));
    expect(readReadingState(storage, "k")).toEqual({ page: 7, zoom: 0.5 });
  });

  it("returns null for missing, malformed or unavailable state, and never throws", () => {
    const storage = new Memory();
    expect(readReadingState(storage, "absent")).toBeNull();
    for (const raw of ["not json", "null", "42", '"x"']) {
      storage.setItem("k", raw);
      expect(readReadingState(storage, "k")).toBeNull();
    }
    expect(readReadingState(null, "k")).toBeNull();
    expect(readReadingState(storage, null)).toBeNull();
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readReadingState(hostile, "k")).toBeNull();
    expect(() => writeReadingState(hostile, "k", { page: 1 })).not.toThrow();
    expect(() => writeReadingState(null, "k", { page: 1 })).not.toThrow();
  });
});
