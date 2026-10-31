// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookError, type StorageLike } from "../src/index.js";
import { readUrlPage, withUrlPage } from "../src/react/hooks/useReadingPosition.js";
import { installDomStubs } from "./helpers/domSetup.js";
import { createFakePdfjs } from "./helpers/fakePdfjs.js";

const pages = Array.from({ length: 6 }, (_, index) => ({
  type: "custom" as const,
  render: () => <p>Content {index + 1}</p>,
}));

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const setUrl = (path: string) => window.history.replaceState(null, "", path);

beforeEach(() => {
  installDomStubs();
  setUrl("/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setUrl("/");
});

const next = () => fireEvent.click(screen.getByRole("button", { name: "Next page" }));

/** What the viewer saved, read back from storage. */
const savedState = (raw: string | null | undefined) => JSON.parse(raw ?? "{}") as { zoom?: number; page?: number };

describe("address helpers", () => {
  it("reads a page from the query string or the hash", () => {
    const query = { param: "page", hash: false };
    const hash = { param: "page", hash: true };
    expect(readUrlPage(query, "http://x.test/a?page=5")).toBe(5);
    expect(readUrlPage(hash, "http://x.test/a#page=5")).toBe(5);
    expect(readUrlPage(hash, "http://x.test/a?page=5")).toBeNull();
    expect(readUrlPage({ param: "p", hash: false }, "http://x.test/a?p=2&page=9")).toBe(2);
  });

  it("only accepts whole page numbers", () => {
    const query = { param: "page", hash: false };
    for (const bad of ["abc", "0", "-3", "2.5", "", "1e2x", "Infinity"]) {
      expect(readUrlPage(query, `http://x.test/?page=${bad}`)).toBeNull();
    }
    expect(readUrlPage(query, "http://x.test/")).toBeNull();
    expect(readUrlPage(query, "not a url")).toBeNull();
  });

  it("sets the page and leaves the rest of the address alone", () => {
    const query = { param: "page", hash: false };
    expect(withUrlPage(query, "http://x.test/a?x=1&page=2#top", 7)).toBe("http://x.test/a?x=1&page=7#top");
    expect(withUrlPage(query, "http://x.test/a", 3)).toBe("http://x.test/a?page=3");
    const hash = { param: "page", hash: true };
    expect(withUrlPage(hash, "http://x.test/a?x=1#section=b", 4)).toBe("http://x.test/a?x=1#section=b&page=4");
    expect(withUrlPage(hash, "http://x.test/a#page=2", 9)).toBe("http://x.test/a#page=9");
  });
});

describe("urlState", () => {
  it("opens at the page in the address", async () => {
    setUrl("/book?page=5");
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState />);
    expect(await screen.findByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("ignores a page that is not a valid number, and clamps one that is too big", async () => {
    setUrl("/book?page=abc");
    const first = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState />);
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    first.unmount();

    setUrl("/book?page=0");
    const second = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState />);
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    second.unmount();

    setUrl("/book?page=99");
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState />);
    expect(await screen.findByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("wins over initialPage and saved state", async () => {
    setUrl("/book?page=3");
    const storage = memoryStorage({ "next-flipbook:state:k": JSON.stringify({ v: 1, page: 5 }) });
    render(
      <FlipBook
        pages={pages}
        aspectRatio="3/4"
        reducedMotion
        urlState
        initialPage={6}
        persistState={{ key: "k", storage }}
      />,
    );
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("keeps the address in step with the page, replacing the history entry and keeping other parts", async () => {
    setUrl("/book?tab=a#top");
    const before = window.history.length;
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState />);
    await screen.findByText("Pages 1–2 of 6");
    // Opening on the first page leaves the address as it was.
    expect(window.location.search).toBe("?tab=a");

    next();
    await screen.findByText("Pages 3–4 of 6");
    expect(window.location.search).toBe("?tab=a&page=3");
    expect(window.location.hash).toBe("#top");
    next();
    await screen.findByText("Pages 5–6 of 6");
    expect(window.location.search).toBe("?tab=a&page=5");
    expect(window.history.length).toBe(before);
  });

  it("adds a history entry per turn with history: push, and follows the back button", async () => {
    const before = window.history.length;
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState={{ history: "push" }} />);
    await screen.findByText("Pages 1–2 of 6");
    next();
    await screen.findByText("Pages 3–4 of 6");
    next();
    await screen.findByText("Pages 5–6 of 6");
    expect(window.history.length).toBe(before + 2);
    expect(window.location.search).toBe("?page=5");

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy());
    // Following the address must not add entries of its own.
    expect(window.history.length).toBe(before + 2);
    expect(window.location.search).toBe("?page=3");
  });

  it("can use the hash, and follows it when it changes", async () => {
    setUrl("/book#page=3");
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState={{ hash: true }} />);
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();

    next();
    await screen.findByText("Pages 5–6 of 6");
    expect(window.location.hash).toBe("#page=5");

    act(() => {
      window.location.hash = "#page=1";
    });
    await waitFor(() => expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy());
  });

  it("uses a custom parameter name", async () => {
    setUrl("/book?p=4&page=2");
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState={{ param: "p" }} />);
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
    next();
    await screen.findByText("Pages 5–6 of 6");
    expect(window.location.search).toBe("?p=5&page=2");
  });

  it("does not touch the address when it is off", async () => {
    setUrl("/book?page=5");
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    next();
    await screen.findByText("Pages 3–4 of 6");
    expect(window.location.search).toBe("?page=5");
  });

  it("stops following the address once the book is gone", async () => {
    const view = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState />);
    await screen.findByText("Pages 1–2 of 6");
    view.unmount();
    setUrl("/book?page=5");
    expect(() => window.dispatchEvent(new PopStateEvent("popstate"))).not.toThrow();
  });

  it("opens at the page in the address under StrictMode, once", async () => {
    setUrl("/book?page=5");
    render(
      <StrictMode>
        <FlipBook pages={pages} aspectRatio="3/4" reducedMotion urlState />
      </StrictMode>,
    );
    expect(await screen.findByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("opens a PDF at the page in the address once the document has loaded", async () => {
    setUrl("/book?page=4");
    const fake = createFakePdfjs({ autoRender: true, numPages: 6 });
    render(
      <FlipBook
        source="/doc.pdf"
        pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/w.mjs" }}
        reducedMotion
        urlState
      />,
    );
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
  });
});

describe("persistState", () => {
  const KEY = "next-flipbook:state:catalog";

  it("opens where the reader left off", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ v: 1, page: 5 }) });
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage }} />);
    expect(await screen.findByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("wins over initialPage", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ v: 1, page: 3 }) });
    render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion initialPage={6} persistState={{ key: "catalog", storage }} />,
    );
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("falls back to initialPage when nothing is saved", async () => {
    const storage = memoryStorage();
    render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion initialPage={5} persistState={{ key: "catalog", storage }} />,
    );
    expect(await screen.findByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("saves the page a moment after the reader stops turning", async () => {
    const storage = memoryStorage();
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage }} />);
    await screen.findByText("Pages 1–2 of 6");
    expect(storage.data.size).toBe(0);

    next();
    next();
    await screen.findByText("Pages 5–6 of 6");
    // Two quick turns are one write, with the final page.
    await waitFor(() => expect(JSON.parse(storage.data.get(KEY) ?? "null")).toEqual({ v: 1, page: 5 }), {
      timeout: 2000,
    });
  });

  it("saves a pending page when the book goes away", async () => {
    const storage = memoryStorage();
    const view = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage }} />);
    await screen.findByText("Pages 1–2 of 6");
    next();
    await screen.findByText("Pages 3–4 of 6");
    view.unmount();
    expect(JSON.parse(storage.data.get(KEY) ?? "null")).toEqual({ v: 1, page: 3 });
  });

  it("remembers zoom, and restores it only when zoomed in", async () => {
    const storage = memoryStorage();
    const first = render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage }} />,
    );
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(savedState(storage.data.get(KEY)).zoom).toBeGreaterThan(1), { timeout: 2000 });
    const saved = savedState(storage.data.get(KEY)).zoom as number;
    first.unmount();

    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage }} />);
    await screen.findByText("Pages 1–2 of 6");
    expect(screen.getByText(`${Math.round(saved * 100)}%`)).toBeTruthy();
  });

  it("leaves zoom alone with zoom: false", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ v: 1, zoom: 2 }) });
    render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage, zoom: false }} />,
    );
    await screen.findByText("Pages 1–2 of 6");
    expect(screen.getByText("100%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(savedState(storage.data.get(KEY)).zoom).toBe(2);
  });

  it("takes a string as the key, and uses localStorage by default", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, page: 3 }));
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState="catalog" />);
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
    next();
    await screen.findByText("Pages 5–6 of 6");
    await waitFor(() => expect(savedState(window.localStorage.getItem(KEY) ?? undefined).page).toBe(5), { timeout: 2000 });
  });

  it("keys a PDF by its URL with persistState: true, and waits for the document", async () => {
    const storage = memoryStorage({ "next-flipbook:state:/doc.pdf": JSON.stringify({ v: 1, page: 4 }) });
    const fake = createFakePdfjs({ autoRender: true, numPages: 6 });
    render(
      <FlipBook
        source="/doc.pdf"
        pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/w.mjs" }}
        reducedMotion
        persistState={{ storage }}
      />,
    );
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("explains itself when there is nothing to key the state by", async () => {
    const errors: FlipBookError[] = [];
    render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState onError={(e) => errors.push(e)} />,
    );
    await screen.findByText("Pages 1–2 of 6");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("INVALID_ARGUMENT");
    expect(errors[0]?.message).toMatch(/persistState/);
    // The book still works.
    next();
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("ignores saved state that is damaged, and storage that throws", async () => {
    const damaged = memoryStorage({ [KEY]: "{not json" });
    const first = render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage: damaged }} />,
    );
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    first.unmount();

    const outOfRange = memoryStorage({ [KEY]: JSON.stringify({ v: 1, page: -4, zoom: 400 }) });
    const second = render(
      <FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage: outOfRange }} />,
    );
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    second.unmount();

    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage: broken }} />);
    await screen.findByText("Pages 1–2 of 6");
    next();
    expect(await screen.findByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("works under StrictMode", async () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ v: 1, page: 5 }) });
    render(
      <StrictMode>
        <FlipBook pages={pages} aspectRatio="3/4" reducedMotion persistState={{ key: "catalog", storage }} />
      </StrictMode>,
    );
    expect(await screen.findByText("Pages 5–6 of 6")).toBeTruthy();
  });
});
