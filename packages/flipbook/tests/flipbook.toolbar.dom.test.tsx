// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FlipBook,
  FlipBookControls,
  FlipBookProvider,
  FlipBookStage,
  FlipBookToolbar,
  FlipBookToolbarButton,
  useFlipBook,
  type FlipBookController,
} from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";
import { createFakePdfjs } from "./helpers/fakePdfjs.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
  for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) {
    Reflect.deleteProperty(document, key);
  }
  Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
});

const pages = Array.from({ length: 6 }, (_, index) => ({
  type: "custom" as const,
  render: () => <p>Content {index + 1}</p>,
}));

const imagePages = Array.from({ length: 6 }, (_, index) => ({
  type: "image" as const,
  src: `/p${index + 1}.jpg`,
  thumbnail: `/t${index + 1}.jpg`,
  width: 300,
  height: 400,
}));

const toolbar = () => screen.getByRole("group", { name: "Flipbook toolbar" });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const queryButton = (name: string | RegExp) => screen.queryByRole("button", { name });

describe("toolbar", () => {
  beforeEach(() => installDomStubs());

  it("has navigation, zoom and fullscreen by default, and nothing optional", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    const bar = within(toolbar());
    for (const name of ["Previous page", "Next page", "Zoom out", "Zoom in", "Fit to window, 100%", "Enter fullscreen"]) {
      expect(bar.getByRole("button", { name })).toBeTruthy();
    }
    expect(bar.getByText("100%")).toBeTruthy();
    for (const name of [/Thumbnails/, /Bookmark/, /Download/, /Print/, /Share/]) {
      expect(queryButton(name)).toBeNull();
    }
  });

  it("each part can be switched off", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion navigation={false} zoom={false} fullscreen={false} />);
    await screen.findByText("Pages 1–2 of 6");
    expect(screen.queryByRole("group", { name: "Flipbook toolbar" })).toBeNull();
  });

  it("toolbar={false} removes the whole bar", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion toolbar={false} />);
    await screen.findByText("Pages 1–2 of 6");
    expect(screen.queryByRole("group", { name: "Flipbook toolbar" })).toBeNull();
    expect(queryButton("Next page")).toBeNull();
  });

  it("hides only what is switched off", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion navigation={false} fullscreen={false} />);
    await screen.findByText("Pages 1–2 of 6");
    expect(queryButton("Next page")).toBeNull();
    expect(queryButton("Enter fullscreen")).toBeNull();
    expect(button("Zoom in")).toBeTruthy();
  });

  it("zoom buttons change the zoom and show it as a percentage", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    expect(button("Zoom out").getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(button("Zoom in"));
    expect(screen.getByText("125%")).toBeTruthy();
    fireEvent.click(button("Zoom in"));
    expect(screen.getByText("150%")).toBeTruthy();
    expect(button("Zoom out").getAttribute("aria-disabled")).toBe("false");

    // The button's name says what it shows, so that "click 150 percent" works by voice.
    fireEvent.click(button("Fit to window, 150%"));
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("names the fit button with the percentage on it, in any language", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion locale={{ fit: "Ajustar a la ventana ({percent}%)" }} />);
    await screen.findByText("Pages 1–2 of 6");
    expect(button("Ajustar a la ventana (100%)").textContent).toBe("100%");
  });

  it("disables zoom in at the maximum", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion maxZoom={1.25} />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Zoom in"));
    expect(button("Zoom in").getAttribute("aria-disabled")).toBe("true");
  });

  it("previous and next buttons work and grey out at the ends", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    expect(button("Previous page").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button("Next page"));
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    fireEvent.click(button("Next page"));
    expect(button("Next page").getAttribute("aria-disabled")).toBe("true");
  });

  it("mirrors the bar for right-to-left books", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion direction="rtl" />);
    await screen.findByText("Pages 1–2 of 6");
    expect(toolbar().getAttribute("dir")).toBe("rtl");
    expect(screen.getByRole("group", { name: "Page navigation" }).getAttribute("dir")).toBe("rtl");
  });

  it("the standalone controls bar mirrors for right-to-left books too", async () => {
    render(
      <FlipBookProvider pages={pages} mode="double" direction="rtl" reducedMotion>
        <FlipBookStage aspectRatio="3/4" />
        <FlipBookControls />
      </FlipBookProvider>,
    );
    await screen.findByText(/Content 1/);
    expect(screen.getByRole("group", { name: "Page navigation" }).getAttribute("dir")).toBe("rtl");
  });

  it("renderToolbar replaces the bar and receives the controls", async () => {
    render(
      <FlipBook
        pages={pages}
        aspectRatio="3/4"
        reducedMotion
        renderToolbar={({ controls }) => (
          <div>
            <output>page {controls.state.currentPage}</output>
            <button type="button" onClick={controls.next}>
              go on
            </button>
          </div>
        )}
      />,
    );
    await screen.findByText("page 1");
    expect(screen.queryByRole("group", { name: "Flipbook toolbar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "go on" }));
    expect(screen.getByText("page 3")).toBeTruthy();
  });

  it("FlipBookToolbar takes children, so a headless viewer can have its own buttons in the same bar", async () => {
    function Custom(): ReactNode {
      const book = useFlipBook();
      return (
        <FlipBookToolbar>
          <FlipBookToolbarButton label="Jump to end" icon="chevron-right" onClick={book.last} />
          <FlipBookToolbarButton label="Pinned" icon="bookmark" pressed />
        </FlipBookToolbar>
      );
    }
    render(
      <FlipBookProvider pages={pages} mode="single" reducedMotion>
        <FlipBookStage aspectRatio="3/4" />
        <Custom />
      </FlipBookProvider>,
    );
    await screen.findByText("Content 1");
    expect(queryButton("Next page")).toBeNull();
    fireEvent.click(button("Jump to end"));
    expect(screen.getByText("Content 6")).toBeTruthy();
    expect(button("Pinned").getAttribute("aria-pressed")).toBe("true");
  });

  it("uses translated labels", async () => {
    render(
      <FlipBook
        pages={pages}
        aspectRatio="3/4"
        reducedMotion
        locale={{ zoomIn: "Acercar", fullscreen: "Pantalla completa", toolbarLabel: "Barra" }}
      />,
    );
    await screen.findByText("Pages 1–2 of 6");
    expect(button("Acercar")).toBeTruthy();
    expect(button("Pantalla completa")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Barra" })).toBeTruthy();
  });
});

describe("fullscreen", () => {
  beforeEach(() => installDomStubs());

  it("falls back to filling the window where the Fullscreen API is missing", async () => {
    const onFullscreenChange = vi.fn();
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion onFullscreenChange={onFullscreenChange} height={300} />);
    await screen.findByText("Pages 1–2 of 6");
    const region = screen.getByRole("region", { name: "Flipbook" });
    document.body.style.overflow = "auto";

    fireEvent.click(button("Enter fullscreen"));
    await waitFor(() => expect(region.style.position).toBe("fixed"));
    expect(region.style.height).toBe("auto"); // the height prop no longer applies
    expect(region.getAttribute("data-flipbook-fullscreen")).toBe("fixed");
    expect(document.body.style.overflow).toBe("hidden");
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true);
    expect(ref.current?.isFullscreen()).toBe(true);
    expect(button("Exit fullscreen").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button("Exit fullscreen"));
    await waitFor(() => expect(region.style.position).toBe("relative"));
    expect(region.style.height).toBe("300px");
    expect(document.body.style.overflow).toBe("auto");
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
  });

  it("F toggles it and Escape leaves the fallback", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    const region = screen.getByRole("region", { name: "Flipbook" });
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.keyDown(region, { key: "f" });
    await waitFor(() => expect(region.style.position).toBe("fixed"));
    fireEvent.keyDown(region, { key: "Escape" });
    await waitFor(() => expect(region.style.position).toBe("relative"));
    fireEvent.keyDown(region, { key: "F" });
    await waitFor(() => expect(region.style.position).toBe("fixed"));
  });

  it("uses the browser's Fullscreen API when it exists", async () => {
    const doc = document as Document & { fullscreenEnabled?: boolean; fullscreenElement?: Element | null; exitFullscreen?: () => Promise<void> };
    doc.fullscreenEnabled = true;
    doc.fullscreenElement = null;
    const request = vi.fn(async function (this: HTMLElement) {
      doc.fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    (HTMLElement.prototype as unknown as { requestFullscreen: typeof request }).requestFullscreen = request;
    doc.exitFullscreen = vi.fn(async () => {
      doc.fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    const region = screen.getByRole("region", { name: "Flipbook" });
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Enter fullscreen"));
    await waitFor(() => expect(region.getAttribute("data-flipbook-fullscreen")).toBe("native"));
    expect(request).toHaveBeenCalledTimes(1);
    expect(region.style.width).toBe("100%");
    expect(region.style.position).toBe("relative");

    // The browser leaves fullscreen on its own (Esc).
    doc.fullscreenElement = null;
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await waitFor(() => expect(region.getAttribute("data-flipbook-fullscreen")).toBeNull());
  });

  it("is switched off by fullscreen={false}, including the key", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion fullscreen={false} />);
    const region = screen.getByRole("region", { name: "Flipbook" });
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.keyDown(region, { key: "f" });
    expect(region.style.position).toBe("relative");
    expect(region.getAttribute("data-flipbook-fullscreen")).toBeNull();
  });

  it("leaves fullscreen and restores page scroll when unmounted", async () => {
    const { unmount } = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion />);
    await screen.findByText("Pages 1–2 of 6");
    document.body.style.overflow = "scroll";
    fireEvent.click(button("Enter fullscreen"));
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });
});

describe("thumbnails", () => {
  beforeEach(() => installDomStubs());

  const panel = (variant = "sidebar") => document.querySelector<HTMLElement>(`[data-flipbook-panel="${variant}"]`);

  it("opens from the toolbar, lists every page and marks the ones on screen", async () => {
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion thumbnails />);
    await screen.findByText("Pages 1–2 of 6");
    expect(panel()).toBeNull();

    fireEvent.click(button("Thumbnails"));
    const nav = await screen.findByRole("navigation", { name: "Thumbnails" });
    expect(panel()).not.toBeNull();
    expect(button("Thumbnails").getAttribute("aria-pressed")).toBe("true");
    const thumbs = nav.querySelectorAll("[data-flipbook-thumb]");
    expect(thumbs).toHaveLength(6);
    expect(Array.from(thumbs).filter((t) => t.getAttribute("aria-current") === "page").map((t) => t.getAttribute("data-flipbook-thumb"))).toEqual(["1", "2"]);

    fireEvent.click(button("Thumbnails"));
    expect(panel()).toBeNull();
  });

  it("goes to a page when its thumbnail is chosen", async () => {
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(screen.getByRole("button", { name: "Go to page 5" }));
    expect(screen.getByText("Pages 5–6 of 6")).toBeTruthy();
    await waitFor(() => {
      const current = document.querySelectorAll('[data-flipbook-thumb][aria-current="page"]');
      expect(Array.from(current).map((c) => c.getAttribute("data-flipbook-thumb"))).toEqual(["5", "6"]);
    });
  });

  it("uses the small image when there is one", async () => {
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 6");
    await waitFor(() => {
      const sources = Array.from(panel()?.querySelectorAll("img") ?? []).map((img) => img.getAttribute("src"));
      expect(sources).toContain("/t3.jpg");
      expect(sources).not.toContain("/p3.jpg");
    });
  });

  it("shows the page number for React pages, which have no picture", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 6");
    const thumb = screen.getByRole("button", { name: "Go to page 3" });
    expect(within(thumb).getAllByText("3").length).toBeGreaterThan(0);
  });

  it("closes with the close button and with Escape", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 6");
    fireEvent.click(button("Close panel"));
    expect(panel()).toBeNull();
    fireEvent.click(button("Thumbnails"));
    fireEvent.keyDown(screen.getByRole("navigation", { name: "Thumbnails" }), { key: "Escape" });
    expect(panel()).toBeNull();
  });

  it("only draws the pictures that are near the scroll position", async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installDomStubs({ intersecting: (el) => Number((el as HTMLElement).dataset.thumbPage) <= 3 || !(el as HTMLElement).dataset.thumbPage });
    render(<FlipBook pages={imagePages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 6");
    await waitFor(() => expect(panel()?.querySelectorAll("img").length).toBe(3));
  });

  it("keeps the page you are reading in view", async () => {
    const scrollIntoView = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: typeof scrollIntoView }).scrollIntoView = scrollIntoView;
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 6");
    scrollIntoView.mockClear();
    fireEvent.click(button("Next page"));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" }));
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("moves between thumbnails with the arrow keys without turning the book", async () => {
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Pages 1–2 of 6");
    const first = screen.getByRole("button", { name: "Go to page 1" });
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("button", { name: "Go to page 4" }).getAttribute("tabindex")).toBe("-1");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go to page 2" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go to page 6" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go to page 1" }));
    // Home and End moved focus; they did not also turn the book.
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
  });

  it("becomes a bottom sheet on a narrow container, and closes after a choice", async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installDomStubs({ width: 500 });
    render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion thumbnails defaultThumbnailsOpen />);
    await screen.findByText("Page 1 of 6");
    expect(panel("sheet")).not.toBeNull();
    expect(panel("sidebar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go to page 4" }));
    expect(screen.getByText("Page 4 of 6")).toBeTruthy();
    expect(panel("sheet")).toBeNull();
  });

  it("is controllable from the ref, and inert when the feature is off", async () => {
    const ref = createRef<FlipBookController>();
    const { rerender } = render(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion thumbnails />);
    await screen.findByText("Pages 1–2 of 6");
    act(() => ref.current?.openPanel("thumbnails"));
    expect(ref.current?.getPanel()).toBe("thumbnails");
    act(() => ref.current?.closePanel());
    expect(ref.current?.getPanel()).toBeNull();
    act(() => ref.current?.togglePanel("thumbnails"));
    expect(panel()).not.toBeNull();

    rerender(<FlipBook ref={ref} pages={pages} aspectRatio="3/4" reducedMotion thumbnails={false} />);
    expect(panel()).toBeNull();
    act(() => ref.current?.openPanel("thumbnails"));
    expect(panel()).toBeNull();
  });

  it("draws small PDF renders for the thumbnails, not full pages", async () => {
    const fake = createFakePdfjs({ autoRender: true, numPages: 6 });
    render(
      <FlipBook
        source="/doc.pdf"
        pdf={{ loadPdfjs: fake.loadPdfjs, workerSrc: "/w.mjs" }}
        reducedMotion
        mode="double"
        thumbnails
        defaultThumbnailsOpen
      />,
    );
    await screen.findByText("Pages 1–2 of 6");
    await waitFor(() => expect(panel()?.querySelectorAll("canvas").length).toBeGreaterThanOrEqual(4));
    const thumbScales = fake.renders.map((r) => r.scale).filter((scale) => scale < 0.3);
    expect(thumbScales.length).toBeGreaterThanOrEqual(4);
  });
});
