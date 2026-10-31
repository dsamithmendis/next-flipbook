// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookError } from "../src/index.js";
import { createFakePdfjs, settle, type FakePdfConfig } from "./helpers/fakePdfjs.js";

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

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
  // jsdom has no canvas; PDF.js is faked, so any context object will do.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function viewer(config: FakePdfConfig = {}) {
  const fake = createFakePdfjs({ autoRender: true, numPages: 6, ...config });
  const pdf = { loadPdfjs: fake.loadPdfjs, workerSrc: "/pdf.worker.mjs" };
  return { fake, pdf };
}

const canvasesOnScreen = (container: HTMLElement): number =>
  container.querySelectorAll("[data-flipbook-page] canvas").length;

describe("<FlipBook source=... />", () => {
  it("shows a loader, then the first spread, and draws the pages on canvases", async () => {
    const { pdf } = viewer();
    const onDocumentLoaded = vi.fn();
    const onPageLoaded = vi.fn();
    const { container } = render(
      <FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onDocumentLoaded={onDocumentLoaded} onPageLoaded={onPageLoaded} />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);

    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    await waitFor(() => expect(canvasesOnScreen(container)).toBe(2));
    expect(onDocumentLoaded).toHaveBeenCalledWith({ numPages: 6 });
    expect(onPageLoaded).toHaveBeenCalledWith(1);
  });

  it("turns pages and draws the new ones", async () => {
    const { fake, pdf } = viewer();
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    await waitFor(() => expect(canvasesOnScreen(container)).toBe(2));
    expect(fake.renders.some((r) => r.docPage === 3)).toBe(true);
  });

  it("honours initialPage once the document has loaded", async () => {
    const { pdf } = viewer();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion initialPage={5} />);
    expect(await screen.findByText("Pages 5–6 of 6")).toBeTruthy();
  });

  it("does not report the first load as a page change", async () => {
    const { pdf } = viewer();
    const onPageChange = vi.fn();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onPageChange={onPageChange} />);
    await screen.findByText("Pages 1–2 of 6");
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("prepares nearby pages ahead of time", async () => {
    const { fake, pdf } = viewer();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion preloadPages={2} />);
    await screen.findByText("Pages 1–2 of 6");
    await waitFor(() => expect(new Set(fake.renders.map((r) => r.docPage))).toEqual(new Set([1, 2, 3, 4])));
  });

  it("shows page-level failures without taking the book down", async () => {
    const { pdf } = viewer({ failRenderOf: [2] });
    const onPageError = vi.fn();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onPageError={onPageError} />);
    expect(await screen.findByText("This page could not be loaded.")).toBeTruthy();
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
    expect(onPageError).toHaveBeenCalledWith(expect.objectContaining({ code: "PAGE_RENDER_FAILED", page: 2 }));
  });

  it("shows an error for a PDF that cannot be opened", async () => {
    const { pdf } = viewer({ loadError: Object.assign(new Error("bad"), { name: "InvalidPDFException" }) });
    const errors: FlipBookError[] = [];
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onError={(e) => errors.push(e)} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/not a valid PDF/);
    expect(errors.map((e) => e.code)).toEqual(["INVALID_PDF"]);
  });

  it("uses a custom error renderer", async () => {
    const { pdf } = viewer({ loadError: new TypeError("Failed to fetch") });
    render(
      <FlipBook source="/doc.pdf" pdf={pdf} reducedMotion renderError={(e) => <p>custom: {e.code}</p>} />,
    );
    expect(await screen.findByText("custom: NETWORK_ERROR")).toBeTruthy();
  });

  it("passes download progress to the loader", async () => {
    const { pdf } = viewer({ progress: { loaded: 40, total: 100 } });
    const seen: Array<number | null> = [];
    render(
      <FlipBook
        source="/doc.pdf"
        pdf={pdf}
        reducedMotion
        renderLoader={({ progress }) => {
          seen.push(progress);
          return <p>loading {progress === null ? "?" : Math.round(progress * 100)}</p>;
        }}
      />,
    );
    await screen.findByText("Pages 1–2 of 6");
    expect(seen).toContain(null);
    expect(seen).toContain(0.4);
  });

  it("builds a book from `pages` that mixes PDF pages with React pages", async () => {
    const { pdf } = viewer();
    const { container } = render(
      <FlipBook
        pdf={pdf}
        reducedMotion
        mode="double"
        pages={[
          { type: "pdf", source: "/doc.pdf", page: 2 },
          { type: "custom", component: <p>Interlude</p> },
        ]}
      />,
    );
    expect(await screen.findByText("Interlude")).toBeTruthy();
    expect(screen.getByText("Pages 1–2 of 2")).toBeTruthy();
    await waitFor(() => expect(canvasesOnScreen(container)).toBe(1));
  });

  it("reports an error when both `source` and `pages` are given", async () => {
    const { pdf } = viewer();
    const errors: FlipBookError[] = [];
    render(
      <FlipBook source="/doc.pdf" pdf={pdf} reducedMotion pages={[{ type: "custom", component: <p>x</p> }]} onError={(e) => errors.push(e)} />,
    );
    await screen.findByText("x");
    expect(errors.map((e) => e.code)).toContain("INVALID_ARGUMENT");
  });
});

describe("passwords", () => {
  it("shows an accessible dialog, rejects a wrong password, and opens on the right one", async () => {
    const { pdf } = viewer({ password: "secret" });
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />);

    const dialog = await screen.findByRole("dialog", { name: "Password required" });
    const input = screen.getByLabelText<HTMLInputElement>("Password");
    expect(document.activeElement).toBe(input);
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not correct/);

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels with Escape and shows PASSWORD_REQUIRED", async () => {
    const { pdf } = viewer({ password: "secret" });
    const errors: FlipBookError[] = [];
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onError={(e) => errors.push(e)} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/password is required/i);
    expect(errors.map((e) => e.code)).toEqual(["PASSWORD_REQUIRED"]);
  });

  it("hands the prompt to onPassword and hides the built-in dialog", async () => {
    const { pdf } = viewer({ password: "secret" });
    const onPassword = vi.fn();
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onPassword={onPassword} />);

    await waitFor(() => expect(onPassword).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    const [callback, reason] = onPassword.mock.calls[0] as [(password: string | null) => void, string];
    expect(reason).toBe("needed");

    act(() => callback("bad"));
    await waitFor(() => expect(onPassword).toHaveBeenCalledTimes(2));
    expect(onPassword.mock.calls[1]?.[1]).toBe("incorrect");

    const retry = onPassword.mock.calls[1]?.[0] as (password: string | null) => void;
    act(() => retry("secret"));
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("opens straight away when pdf.password is correct", async () => {
    const { pdf } = viewer({ password: "secret" });
    render(<FlipBook source="/doc.pdf" pdf={{ ...pdf, password: "secret" }} reducedMotion />);
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("lifecycle", () => {
  it("terminates the worker and cancels renders on unmount", async () => {
    const { fake, pdf } = viewer({ autoRender: false });
    const { unmount } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    await waitFor(() => expect(fake.renders.length).toBeGreaterThan(0));
    unmount();
    await settle();
    expect(fake.stats.tasksDestroyed).toBe(1);
    expect(fake.renders.every((r) => r.cancelled || r.settled)).toBe(true);
    expect(fake.renders.some((r) => r.cancelled)).toBe(true);
  });

  it("works under React Strict Mode: one live worker, and the book still renders", async () => {
    const { fake, pdf } = viewer();
    const { container } = render(
      <StrictMode>
        <FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />
      </StrictMode>,
    );
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
    await waitFor(() => expect(canvasesOnScreen(container)).toBe(2));
    await settle();
    // Strict Mode mounts twice, so one worker was opened and closed before the live one.
    expect(fake.stats.initCalls.length - fake.stats.tasksDestroyed).toBe(1);
  });

  it("opens a new document when `source` changes and closes the old one", async () => {
    const { fake, pdf } = viewer();
    const { rerender } = render(<FlipBook source="/a.pdf" pdf={pdf} reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    rerender(<FlipBook source="/b.pdf" pdf={pdf} reducedMotion />);
    await waitFor(() => expect(fake.stats.initCalls.map((c) => c.url)).toEqual(["/a.pdf", "/b.pdf"]));
    await settle();
    expect(fake.stats.tasksDestroyed).toBe(1);
    expect(await screen.findByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("does not reload the document when the parent re-renders with a new pdf object", async () => {
    const { fake, pdf } = viewer();
    const { rerender } = render(<FlipBook source="/a.pdf" pdf={{ ...pdf }} reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    rerender(<FlipBook source="/a.pdf" pdf={{ ...pdf }} reducedMotion />);
    await settle();
    expect(fake.stats.initCalls).toHaveLength(1);
  });
});
