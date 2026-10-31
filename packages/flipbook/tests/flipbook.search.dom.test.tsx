// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController } from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";
import { createFakePdfjs, type FakePdfConfig } from "./helpers/fakePdfjs.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => installDomStubs());

const TEXT: Record<number, string> = {
  1: "Welcome to the guide",
  2: "Chapter one begins here",
  3: "A needle in a haystack",
  4: "Another needle appears",
  5: "Nothing to see",
  6: "The final needle",
};

function viewer(config: FakePdfConfig = {}) {
  const fake = createFakePdfjs({ autoRender: true, numPages: 6, text: TEXT, ...config });
  const pdf = { loadPdfjs: fake.loadPdfjs, workerSrc: "/pdf.worker.mjs" };
  return { fake, pdf };
}

const input = () => screen.getByRole<HTMLInputElement>("searchbox", { name: "Search the document" });
const highlights = (container: HTMLElement) => container.querySelectorAll("[data-flipbook-highlight]");
const currentHighlights = (container: HTMLElement) =>
  container.querySelectorAll('[data-flipbook-highlight="current"]');

async function openSearch() {
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  return input();
}

async function type(value: string) {
  const box = input();
  fireEvent.change(box, { target: { value } });
  return box;
}

describe("search", () => {
  it("offers search only for a PDF, and only when asked for", async () => {
    const { pdf } = viewer();
    const first = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    first.unmount();

    const second = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    second.unmount();

    // Image and React pages have no text to search.
    render(
      <FlipBook
        pages={[{ type: "custom", render: () => <p>One</p> }, { type: "custom", render: () => <p>Two</p> }]}
        aspectRatio="3/4"
        reducedMotion
        search
      />,
    );
    await screen.findByText("Pages 1–2 of 2");
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });

  it("opens a panel with a focused search box", async () => {
    const { pdf } = viewer();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");
    const box = await openSearch();
    expect(document.activeElement).toBe(box);
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("finds every match, jumps to the first one at or after the current page, and highlights it", async () => {
    const { pdf } = viewer();
    const onSearch = vi.fn();
    const onSearchResult = vi.fn();
    const { container } = render(
      <FlipBook
        source="/doc.pdf"
        pdf={pdf}
        reducedMotion
        search
        onSearch={onSearch}
        onSearchResult={onSearchResult}
      />,
    );
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    await type("needle");

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 3"), { timeout: 3000 });
    // Page 3 is the first page with a match after the cover spread.
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /needle/ })).toHaveLength(3);
    expect(onSearch).toHaveBeenCalledWith("needle");
    expect(onSearchResult).toHaveBeenCalledWith({ query: "needle", count: 3, truncated: false });

    // Pages 3 and 4 are on screen, each with one match; the first is the selected one.
    await waitFor(() => expect(highlights(container).length).toBe(2));
    expect(currentHighlights(container).length).toBe(1);

    // Highlights are plain translucent fills, not a blend mode (which hides them on a dark
    // page), and the selected one has an outline so it stands out on any background.
    const selected = currentHighlights(container)[0] as HTMLElement;
    const other = Array.from(highlights(container)).find((node) => node !== selected) as HTMLElement;
    expect(selected.getAttribute("style")).not.toContain("mix-blend-mode");
    expect(other.getAttribute("style")).not.toContain("mix-blend-mode");
    expect(selected.getAttribute("style")).toContain("outline");
    expect(other.getAttribute("style")).not.toContain("outline");
  });

  it("steps through the results with Enter and Shift+Enter, turning the book as it goes", async () => {
    const { pdf } = viewer();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    const box = await type("needle");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 3"), { timeout: 3000 });

    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toBe("2 of 3");
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();

    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toBe("3 of 3");
    expect(screen.getByText("Pages 5–6 of 6")).toBeTruthy();

    // Wraps around.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toBe("1 of 3");
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();

    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("status").textContent).toBe("3 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));
    expect(screen.getByRole("status").textContent).toBe("2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Next result" }));
    expect(screen.getByRole("status").textContent).toBe("3 of 3");
  });

  it("goes to a result's page when it is chosen from the list, even if it is already selected", async () => {
    const { pdf } = viewer();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    await type("needle");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 3"), { timeout: 3000 });

    const results = screen.getAllByRole("button", { name: /needle/ });
    fireEvent.click(results[2] as HTMLElement);
    expect(screen.getByText("Pages 5–6 of 6")).toBeTruthy();

    // Back to the front, then choose the selected result again: it must come back to it.
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /needle/ })[2] as HTMLElement);
    expect(screen.getByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("says so when nothing matches", async () => {
    const { pdf } = viewer();
    const onSearchResult = vi.fn();
    const { container } = render(
      <FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search onSearchResult={onSearchResult} />,
    );
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    await type("zebra");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("No results"), { timeout: 3000 });
    expect(highlights(container).length).toBe(0);
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
    expect(onSearchResult).toHaveBeenCalledWith({ query: "zebra", count: 0, truncated: false });
  });

  it("matches without regard to case or extra whitespace", async () => {
    const { pdf } = viewer();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    await type("CHAPTER   one");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 1"), { timeout: 3000 });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("does not search for a query shorter than the minimum", async () => {
    const { fake, pdf } = viewer();
    const onSearch = vi.fn();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search onSearch={onSearch} />);
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    await type("n");
    // Give the debounce time to fire.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(fake.stats.textReads).toBe(0);
  });

  it("honours search options", async () => {
    const { pdf } = viewer();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search={{ minLength: 1, maxResults: 2 }} />);
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    await type("needle");
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^1 of 2/), { timeout: 3000 });
    expect(screen.getByRole("status").textContent).toMatch(/first 2 results/);
  });

  it("removes the highlights and results when the panel is closed", async () => {
    const { pdf } = viewer();
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");
    await openSearch();
    await type("needle");
    await waitFor(() => expect(highlights(container).length).toBe(2), { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(highlights(container).length).toBe(0));

    // Opening it again starts empty.
    const box = await openSearch();
    expect(box.value).toBe("");
    expect(screen.queryAllByRole("button", { name: /needle/ })).toHaveLength(0);
  });

  it("follows the search from the controller", async () => {
    const { pdf } = viewer();
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");

    await act(async () => {
      await ref.current?.search("needle");
    });
    expect(input().value).toBe("needle");
    expect(screen.getByRole("status").textContent).toBe("1 of 3");
    expect(ref.current?.getSearchResults().map((r) => r.position)).toEqual([3, 4, 6]);

    act(() => ref.current?.nextSearchResult());
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    act(() => ref.current?.nextSearchResult());
    expect(screen.getByText("Pages 5–6 of 6")).toBeTruthy();
    act(() => ref.current?.previousSearchResult());
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    act(() => ref.current?.clearSearch());
    expect(ref.current?.getSearchResults()).toEqual([]);
  });

  it("is inert when the search prop is off", async () => {
    const { fake, pdf } = viewer();
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} source="/doc.pdf" pdf={pdf} reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    await act(async () => {
      await ref.current?.search("needle");
    });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(fake.stats.textReads).toBe(0);
  });

  it("opens with the / key, focuses the box if it is already open, and closes with Escape", async () => {
    const { pdf } = viewer();
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion search />);
    await screen.findByText("Pages 1–2 of 6");
    const root = container.querySelector('[role="region"]') as HTMLElement;

    fireEvent.keyDown(root, { key: "/" });
    expect(document.activeElement).toBe(input());

    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(root, { key: "/" });
    expect(document.activeElement).toBe(input());

    fireEvent.keyDown(root, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("ignores the / key when search is off", async () => {
    const { pdf } = viewer();
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.keyDown(container.querySelector('[role="region"]') as HTMLElement, { key: "/" });
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
