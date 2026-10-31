// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FlipBook,
  FlipBookProvider,
  FlipBookStage,
  useFlipBook,
  type FlipBookController,
} from "../src/index.js";

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const pages = Array.from({ length: 6 }, (_, index) => ({
  type: "custom" as const,
  render: () => <p>Content {index + 1}</p>,
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 900,
    height: 600,
    top: 0,
    left: 0,
    right: 900,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const region = () => screen.getByRole("region", { name: "Flipbook" });

describe("<FlipBook />", () => {
  it("shows a two-page spread on a wide container in auto mode", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    expect(screen.getByText("Content 1")).toBeTruthy();
    expect(screen.getByText("Content 2")).toBeTruthy();
    expect(screen.queryByText("Content 3")).toBeNull();
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("shows a single page below the breakpoint", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" breakpoint={1200} reducedMotion />);
    expect(screen.getByText("Content 1")).toBeTruthy();
    expect(screen.queryByText("Content 2")).toBeNull();
    expect(screen.getByText("Page 1 of 6")).toBeTruthy();
  });

  it("only mounts the visible pages of a long book", () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      type: "custom" as const,
      render: () => <p>Item {index + 1}</p>,
    }));
    const { container } = render(<FlipBook pages={many} aspectRatio="3/4" reducedMotion />);
    expect(container.querySelectorAll("[data-flipbook-page]").length).toBeLessThanOrEqual(2);
  });

  it("navigates with the buttons and reports page changes", () => {
    const onPageChange = vi.fn();
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Content 3")).toBeTruthy();
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("marks the previous button as disabled on the first page", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    expect(screen.getByRole("button", { name: "Previous page" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("supports keyboard navigation", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    fireEvent.keyDown(region(), { key: "ArrowRight" });
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    fireEvent.keyDown(region(), { key: "End" });
    expect(screen.getByText("Pages 5–6 of 6")).toBeTruthy();
    fireEvent.keyDown(region(), { key: "Home" });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("reverses arrow keys for right-to-left books", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" direction="rtl" reducedMotion />);
    fireEvent.keyDown(region(), { key: "ArrowLeft" });
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    fireEvent.keyDown(region(), { key: "ArrowRight" });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("can turn keyboard control off", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" keyboard={false} reducedMotion />);
    fireEvent.keyDown(region(), { key: "ArrowRight" });
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("hides the buttons when navigation is off", () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" navigation={false} reducedMotion />);
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("exposes an imperative controller through ref", () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion />);
    act(() => ref.current?.goToPage(5));
    expect(ref.current?.getCurrentPage()).toBe(5);
    expect(ref.current?.getPageCount()).toBe(6);
    expect(ref.current?.isAnimating()).toBe(false);
    expect(screen.getByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("supports a fully custom UI through the headless provider", () => {
    function CustomUI() {
      const book = useFlipBook();
      return (
        <div>
          <output>current {book.state.currentPage}</output>
          <button type="button" onClick={book.next}>
            go
          </button>
          <FlipBookStage aspectRatio="3/4" />
        </div>
      );
    }
    render(
      <FlipBookProvider pages={pages} mode="single" reducedMotion>
        <CustomUI />
      </FlipBookProvider>,
    );
    expect(screen.getByText("current 1")).toBeTruthy();
    expect(screen.getByText("Content 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("current 2")).toBeTruthy();
    expect(screen.getByText("Content 2")).toBeTruthy();
  });

  it("throws a helpful error when useFlipBook is used outside a provider", () => {
    function Broken() {
      useFlipBook();
      return null;
    }
    const silence = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Broken />)).toThrow(/FlipBookProvider/);
    silence.mockRestore();
  });

  it("calls onReady once the book is drawn", () => {
    const onReady = vi.fn();
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion onReady={onReady} />);
    expect(onReady).toHaveBeenCalled();
  });

  it("uses custom locale strings", () => {
    render(
      <FlipBook
        pages={pages}
        aspectRatio="3/4"
        reducedMotion
        locale={{ next: "Siguiente", previous: "Anterior" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeTruthy();
  });

  it("renders the empty state", () => {
    render(<FlipBook pages={[]} renderEmpty={() => <p>Nothing here</p>} />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });

  it("reports a broken image once, to both onError and onPageError", () => {
    const onError = vi.fn();
    const onPageError = vi.fn();
    const { container } = render(
      <FlipBook
        pages={[{ type: "image", src: "/missing.jpg", width: 300, height: 400 }]}
        mode="single"
        reducedMotion
        onError={onError}
        onPageError={onPageError}
      />,
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image as HTMLImageElement);
    expect(screen.getByText("This page could not be loaded.")).toBeTruthy();
    for (const spy of [onError, onPageError]) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ code: "IMAGE_LOAD_FAILED", page: 1 }));
    }
  });

  it("cleans up: unmounting mid-turn leaves no frames running", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    const { unmount } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(rafSpy).toHaveBeenCalled();
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
