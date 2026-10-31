// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController, type FlipBookError } from "../src/index.js";
import { FlipBookRuntimeError } from "../src/core/errors.js";
import { printPages } from "../src/actions/print.js";
import { CancelledError } from "../src/pdf/errors.js";
import { installDomStubs } from "./helpers/domSetup.js";
import type * as PrintModule from "../src/actions/print.js";
import { createFakePdfjs } from "./helpers/fakePdfjs.js";

// Real printing needs a browser dialog, so the print job itself is replaced.
vi.mock("../src/actions/print.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PrintModule>();
  return { ...actual, printPages: vi.fn() };
});

const imagePages = Array.from({ length: 6 }, (_, index) => ({
  type: "image" as const,
  src: `/pages/${index + 1}.jpg`,
  width: 300,
  height: 400,
}));
const customPages = Array.from({ length: 4 }, (_, index) => ({
  type: "custom" as const,
  render: () => <p>Content {index + 1}</p>,
}));

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const queryButton = (name: string | RegExp) => screen.queryByRole("button", { name });
const notice = () => document.querySelector("[data-flipbook-notice]")?.textContent ?? null;

beforeEach(() => {
  installDomStubs();
  vi.mocked(printPages).mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("download", () => {
  let clicks: Array<{ href: string; download: string; target: string }>;
  beforeEach(() => {
    clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.getAttribute("download") ?? "", target: this.target });
    });
  });

  it("downloads the file named in the options", async () => {
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion download={{ url: "/files/menu.pdf", filename: "Spring Menu.pdf" }} />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Download"));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]?.href).toBe(`${location.origin}/files/menu.pdf`);
    expect(clicks[0]?.download).toBe("Spring Menu.pdf");
  });

  it("downloads the PDF that is being shown", async () => {
    const fake = createFakePdfjs({ autoRender: true, numPages: 4 });
    render(<FlipBook source="/docs/report.pdf" pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/w.mjs" }} reducedMotion download />);
    await screen.findByText("Pages 1–2 of 4");
    fireEvent.click(button("Download"));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]).toMatchObject({ download: "report.pdf" });
  });

  it("has no button when there is nothing to download", async () => {
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion download />);
    await screen.findByText("Pages 1–2 of 6");
    expect(queryButton("Download")).toBeNull();
  });

  it("is off by default", async () => {
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    expect(queryButton("Download")).toBeNull();
  });

  it("tells the reader and reports an error when the browser refuses", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });
    const errors: FlipBookError[] = [];
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion download={{ url: "/a.pdf" }} onError={(e) => errors.push(e)} />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Download"));
    await waitFor(() => expect(notice()).toBe("The file could not be downloaded."));
    expect(errors.map((e) => e.code)).toEqual(["DOWNLOAD_FAILED"]);
  });
});

describe("print", () => {
  it("is offered for image pages, not for a book made only of React pages", async () => {
    const images = render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion print />);
    await screen.findByText("Pages 1–2 of 6");
    expect(button("Print")).toBeTruthy();
    images.unmount();

    render(<FlipBook pages={customPages} aspectRatio="3/4" reducedMotion print />);
    await screen.findByText("Pages 1–2 of 4");
    expect(queryButton("Print")).toBeNull();
  });

  it("hands the pages, not the viewer, to the print job, and shows progress while it works", async () => {
    let finish!: () => void;
    const loaded: Array<string | undefined> = [];
    vi.mocked(printPages).mockImplementation(async (source, options) => {
      for (let i = 0; i < source.total; i += 1) loaded.push((await source.load(i, new AbortController().signal))?.src);
      options?.onProgress?.(2, source.total);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { printed: source.total, skipped: 0 };
    });

    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion print />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Print"));

    await waitFor(() => expect(notice()).toBe("Preparing to print… 2 of 6"));
    expect(button("Print").getAttribute("aria-busy")).toBe("true");
    expect(button("Print").getAttribute("aria-disabled")).toBe("true");
    expect(loaded).toEqual([1, 2, 3, 4, 5, 6].map((n) => `${location.origin}/pages/${n}.jpg`));

    fireEvent.click(button("Print")); // already printing
    expect(printPages).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    await waitFor(() => expect(notice()).toBeNull());
    expect(button("Print").getAttribute("aria-busy")).toBe("false");
  });

  it("skips React pages in a mixed book", async () => {
    vi.mocked(printPages).mockImplementation(async (source) => ({ printed: source.total, skipped: 0 }));
    render(<FlipBook pages={[...customPages, ...imagePages.slice(0, 2)]} aspectRatio="3/4" reducedMotion print />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Print"));
    await waitFor(() => expect(printPages).toHaveBeenCalled());
    expect(vi.mocked(printPages).mock.calls[0]?.[0].total).toBe(2);
  });

  it("renders PDF pages at the print scale and turns each into an image URL", async () => {
    const fake = createFakePdfjs({ autoRender: true, numPages: 3 });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:print/1", revokeObjectURL: () => undefined }));
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["jpeg"])));
    const printables: Array<string | undefined> = [];
    vi.mocked(printPages).mockImplementation(async (source) => {
      for (let i = 0; i < source.total; i += 1) printables.push((await source.load(i, new AbortController().signal))?.src);
      return { printed: source.total, skipped: 0 };
    });

    render(<FlipBook source="/doc.pdf" pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/w.mjs" }} reducedMotion print={{ scale: 3 }} />);
    await screen.findByText("Pages 1–2 of 3");
    fireEvent.click(button("Print"));
    await waitFor(() => expect(printables).toHaveLength(3));
    expect(printables.every((src) => src === "blob:print/1")).toBe(true);
    expect(fake.renders.filter((r) => r.scale === 3).map((r) => r.docPage)).toEqual([1, 2, 3]);
  });

  it("tells the reader when printing fails, and can be tried again", async () => {
    vi.mocked(printPages).mockRejectedValueOnce(new FlipBookRuntimeError("PRINT_FAILED", "There was nothing to print."));
    const errors: FlipBookError[] = [];
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion print onError={(e) => errors.push(e)} />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Print"));
    await waitFor(() => expect(notice()).toBe("Printing failed."));
    expect(errors.map((e) => e.code)).toEqual(["PRINT_FAILED"]);
    expect(button("Print").getAttribute("aria-disabled")).toBe("false");

    vi.mocked(printPages).mockResolvedValueOnce({ printed: 6, skipped: 0 });
    fireEvent.click(button("Print"));
    await waitFor(() => expect(printPages).toHaveBeenCalledTimes(2));
  });

  it("cancels the job when the viewer unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(printPages).mockImplementation(
      (_source, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          signal?.addEventListener("abort", () => reject(new CancelledError()));
        }),
    );
    const { unmount } = render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion print />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Print"));
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("is inert from the controller when the feature is off", async () => {
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={imagePages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    await act(async () => ref.current?.print());
    expect(printPages).not.toHaveBeenCalled();
  });
});

describe("share", () => {
  it("opens the system share sheet with the page address and title", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    document.title = "Spring catalog";
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion share />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Share"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({ url: location.href, title: "Spring catalog" });
  });

  it("uses the address, title and text from the options", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion share={{ url: "https://x.test/book", title: "My book", text: "Have a look" }} />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Share"));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ url: "https://x.test/book", title: "My book", text: "Have a look" }));
  });

  it("copies the link and says so when there is no share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion share={{ url: "https://x.test/a" }} />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Share"));
    await waitFor(() => expect(notice()).toBe("Link copied to the clipboard."));
    expect(writeText).toHaveBeenCalledWith("https://x.test/a");
  });

  it("says nothing when the reader closes the share sheet", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" }));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion share />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Share"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(notice()).toBeNull();
  });

  it("reports when nothing worked", async () => {
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion share />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Share"));
    await waitFor(() => expect(notice()).toBe("The link could not be shared or copied."));
  });

  it("onShare replaces the built-in behaviour", async () => {
    const share = vi.fn();
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const onShare = vi.fn();
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion share={{ url: "https://x.test/z", title: "Z" }} onShare={onShare} />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Share"));
    await waitFor(() => expect(onShare).toHaveBeenCalledWith({ url: "https://x.test/z", title: "Z" }));
    expect(share).not.toHaveBeenCalled();
  });

  it("clears its own notice after a moment", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion share />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Share"));
    await waitFor(() => expect(notice()).not.toBeNull());
    await waitFor(() => expect(notice()).toBeNull(), { timeout: 5000 });
  });
});
