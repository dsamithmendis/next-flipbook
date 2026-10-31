// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type BookmarkStorage, type FlipBookController, type FlipBookError } from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";
import { createFakePdfjs } from "./helpers/fakePdfjs.js";

class MemoryStorage implements BookmarkStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

beforeEach(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const pages = Array.from({ length: 8 }, (_, index) => ({
  type: "custom" as const,
  render: () => <p>Content {index + 1}</p>,
}));

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const ribbon = (page: number) => document.querySelector(`[data-flipbook-page="${page}"] [data-flipbook-ribbon]`);
const notice = () => document.querySelector("[data-flipbook-notice]")?.textContent ?? null;
const ready = () => screen.findByText("Pages 1–2 of 8");

describe("bookmarking the current page", () => {
  it("is off unless asked for", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion />);
    await ready();
    expect(screen.queryByRole("button", { name: /bookmark/i })).toBeNull();
    fireEvent.keyDown(screen.getByRole("region", { name: "Flipbook" }), { key: "b" });
    act(() => ref.current?.toggleBookmark());
    expect(ref.current?.getBookmarks()).toEqual([]);
    expect(ribbon(1)).toBeNull();
  });

  it("toggles with the toolbar button, shows a ribbon and says what happened", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks />);
    await ready();
    const toggle = button("Bookmark this page");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(button("Remove bookmark").getAttribute("aria-pressed")).toBe("true");
    expect(ribbon(1)).not.toBeNull();
    expect(ribbon(2)).toBeNull();
    expect(notice()).toBe("Bookmarked page 1");
    expect(screen.getByRole("status", { name: "" })).toBeTruthy();

    fireEvent.click(button("Remove bookmark"));
    expect(ribbon(1)).toBeNull();
    expect(notice()).toBe("Removed bookmark from page 1");
    expect(button("Bookmark this page").getAttribute("aria-pressed")).toBe("false");
  });

  it("the B key does the same", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks />);
    await ready();
    const region = screen.getByRole("region", { name: "Flipbook" });
    fireEvent.keyDown(region, { key: "b" });
    expect(ribbon(1)).not.toBeNull();
    fireEvent.keyDown(region, { key: "B" });
    expect(ribbon(1)).toBeNull();
  });

  it("follows the reader: the button reflects the pages on screen", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks />);
    await ready();
    fireEvent.click(button("Bookmark this page"));
    fireEvent.click(button("Next page"));
    expect(screen.getByText("Pages 3–4 of 8")).toBeTruthy();
    expect(button("Bookmark this page").getAttribute("aria-pressed")).toBe("false");
    expect(ribbon(1)).toBeNull();
    fireEvent.click(button("Previous page"));
    expect(button("Remove bookmark").getAttribute("aria-pressed")).toBe("true");
    expect(ribbon(1)).not.toBeNull();
  });

  it("on a spread, removes an existing bookmark rather than adding a second", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ defaultValue: [2] }} />);
    await ready();
    expect(button("Remove bookmark").getAttribute("aria-pressed")).toBe("true");
    expect(ribbon(2)).not.toBeNull();
    fireEvent.click(button("Remove bookmark"));
    expect(ref.current?.getBookmarks()).toEqual([]);
  });

  it("puts the ribbon on the page while it turns, too", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" bookmarks duration={400} />);
    await ready();
    fireEvent.click(button("Next page"));
    fireEvent.click(button("Bookmark this page"));
    await waitFor(() => expect(ribbon(3)).not.toBeNull(), { timeout: 2000 });
  });
});

describe("the bookmark list", () => {
  it("lists bookmarks, jumps to one and removes one", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ defaultValue: [3, 7] }} />);
    await ready();

    fireEvent.click(button("Bookmarks"));
    const list = await screen.findByRole("navigation", { name: "Bookmarks" });
    const rows = list.querySelectorAll("[data-flipbook-bookmark]");
    expect(Array.from(rows).map((row) => row.getAttribute("data-flipbook-bookmark"))).toEqual(["3", "7"]);

    fireEvent.click(within(list).getByRole("button", { name: "Go to page 7" }));
    expect(screen.getByText("Pages 7–8 of 8")).toBeTruthy();

    fireEvent.click(within(list).getByRole("button", { name: "Remove bookmark from page 3" }));
    expect(ref.current?.getBookmarks()).toEqual([7]);
    expect(within(list).queryByRole("button", { name: "Go to page 3" })).toBeNull();
  });

  it("says so when there are none", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks />);
    await ready();
    fireEvent.click(button("Bookmarks"));
    expect(await screen.findByText(/No bookmarks yet/)).toBeTruthy();
  });

  it("has tabs next to the thumbnails when both are on", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks thumbnails defaultThumbnailsOpen />);
    await ready();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Pages", "Bookmarks"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tabs[1] as HTMLElement);
    expect(await screen.findByRole("navigation", { name: "Bookmarks" })).toBeTruthy();
    expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(screen.getAllByRole("tab")[1] as HTMLElement, { key: "ArrowLeft" });
    expect(await screen.findByRole("navigation", { name: "Thumbnails" })).toBeTruthy();
    // The arrow key moved between tabs; it did not turn the book.
    expect(screen.getByText("Pages 1–2 of 8")).toBeTruthy();
  });

  it("shows a ribbon on bookmarked thumbnails and says so in their label", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ defaultValue: [4] }} thumbnails defaultThumbnailsOpen />);
    await ready();
    const thumb = screen.getByRole("button", { name: "Go to page 4, bookmarked" });
    expect(thumb.querySelector("[data-flipbook-ribbon]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Go to page 5" }).querySelector("[data-flipbook-ribbon]")).toBeNull();
  });
});

describe("events and controlled value", () => {
  it("reports the reader's changes through onChange", async () => {
    const onChange = vi.fn();
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ onChange }} />);
    await ready();
    fireEvent.click(button("Bookmark this page"));
    fireEvent.click(button("Next page"));
    fireEvent.click(button("Bookmark this page"));
    expect(onChange.mock.calls.map((call: unknown[]) => call[0])).toEqual([[1], [1, 3]]);
  });

  it("starts from value and follows it when it changes, without echoing back", async () => {
    const onChange = vi.fn();
    const ref = createRef<FlipBookController>();
    const { rerender } = render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ value: [2, 4], onChange }} />);
    await ready();
    expect(ref.current?.getBookmarks()).toEqual([2, 4]);
    expect(ribbon(2)).not.toBeNull();

    rerender(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ value: [1, 5, 6], onChange }} />);
    await waitFor(() => expect(ref.current?.getBookmarks()).toEqual([1, 5, 6]));
    expect(ribbon(1)).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an inline value array that never changes does not reset the reader's bookmarks", async () => {
    const ref = createRef<FlipBookController>();
    const { rerender } = render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ value: [2] }} />);
    await ready();
    act(() => ref.current?.addBookmark(5));
    rerender(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ value: [2] }} />);
    expect(ref.current?.getBookmarks()).toEqual([2, 5]);
  });

  it("ignores pages that do not exist", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ defaultValue: [0, 3, 99] }} />);
    await ready();
    expect(ref.current?.getBookmarks()).toEqual([3]);
    act(() => ref.current?.addBookmark(50));
    expect(ref.current?.getBookmarks()).toEqual([3]);
  });

  it("works through the controller", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks />);
    await ready();
    act(() => ref.current?.addBookmark(6));
    act(() => ref.current?.addBookmark());
    expect(ref.current?.getBookmarks()).toEqual([1, 6]);
    expect(ref.current?.isBookmarked(6)).toBe(true);
    expect(ref.current?.isBookmarked()).toBe(true);
    act(() => ref.current?.toggleBookmark(6));
    act(() => ref.current?.removeBookmark());
    expect(ref.current?.getBookmarks()).toEqual([]);
    act(() => ref.current?.addBookmark(2));
    act(() => ref.current?.clearBookmarks());
    expect(ref.current?.getBookmarks()).toEqual([]);
  });
});

describe("remembering bookmarks", () => {
  it("saves under a prefixed key and loads them on the next visit", async () => {
    const storage = new MemoryStorage();
    const first = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ persist: "catalog", storage }} />);
    await ready();
    fireEvent.click(button("Bookmark this page"));
    expect(JSON.parse(storage.data.get("next-flipbook:bookmarks:catalog") ?? "{}")).toEqual({ v: 1, pages: [1] });
    first.unmount();

    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ persist: "catalog", storage }} />);
    await ready();
    await waitFor(() => expect(ribbon(1)).not.toBeNull());
    expect(button("Remove bookmark").getAttribute("aria-pressed")).toBe("true");
  });

  it("uses localStorage by default", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ persist: "default-store" }} />);
    await ready();
    fireEvent.click(button("Bookmark this page"));
    expect(localStorage.getItem("next-flipbook:bookmarks:default-store")).toContain('"pages":[1]');
  });

  it("derives the key from a PDF URL when persist is true", async () => {
    const storage = new MemoryStorage();
    const fake = createFakePdfjs({ autoRender: true, numPages: 8 });
    render(
      <FlipBook source="/menus/spring.pdf" pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/w.mjs" }} reducedMotion bookmarks={{ persist: true, storage }} />,
    );
    await ready();
    fireEvent.click(button("Bookmark this page"));
    expect([...storage.data.keys()]).toEqual(["next-flipbook:bookmarks:/menus/spring.pdf"]);
  });

  it("asks for a key when it cannot derive one", async () => {
    const errors: FlipBookError[] = [];
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ persist: true }} onError={(e) => errors.push(e)} />);
    await ready();
    expect(errors.map((e) => e.code)).toContain("INVALID_ARGUMENT");
    expect(errors.find((e) => e.code === "INVALID_ARGUMENT")?.message).toMatch(/string key/);
  });

  it("keeps working when storage is full or blocked", async () => {
    const broken: BookmarkStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ persist: "x", storage: broken }} />);
    await ready();
    fireEvent.click(button("Bookmark this page"));
    expect(ref.current?.getBookmarks()).toEqual([1]);
    expect(ribbon(1)).not.toBeNull();
  });

  it("picks up a change made in another tab", async () => {
    const storage = new MemoryStorage();
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ persist: "shared", storage }} />);
    await ready();
    storage.setItem("next-flipbook:bookmarks:shared", JSON.stringify({ v: 1, pages: [2, 6] }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "next-flipbook:bookmarks:shared" }));
    });
    expect(ref.current?.getBookmarks()).toEqual([2, 6]);
    expect(ribbon(2)).not.toBeNull();
  });

  it("a controlled value wins over what was saved", async () => {
    const storage = new MemoryStorage();
    storage.setItem("next-flipbook:bookmarks:both", JSON.stringify({ v: 1, pages: [5] }));
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion bookmarks={{ persist: "both", storage, value: [2] }} />);
    await ready();
    await waitFor(() => expect(ref.current?.getBookmarks()).toEqual([2]));
  });
});
