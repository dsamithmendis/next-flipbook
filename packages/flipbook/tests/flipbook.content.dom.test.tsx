// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlipBook, type FlipBookController, type FlipBookHotspot } from "../src/index.js";
import { installDomStubs } from "./helpers/domSetup.js";
import { createFakePdfjs, type FakePdfConfig } from "./helpers/fakePdfjs.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => installDomStubs());

const OUTLINE = [
  {
    title: "Chapter 1",
    dest: [{ page: 1 }, { name: "Fit" }],
    items: [{ title: "Section 1.1", dest: [{ page: 2 }] }],
  },
  {
    title: "Chapter 2",
    dest: [{ page: 3 }],
    items: [
      { title: "Section 2.1", dest: [{ page: 4 }] },
      { title: "Section 2.2", dest: [{ page: 5 }] },
    ],
  },
  { title: "Appendix", dest: [{ page: 6 }] },
  { title: "Website", url: "https://example.com/" },
  { title: "Unsafe", url: "javascript:alert(1)" },
];

function viewer(config: FakePdfConfig = {}) {
  const fake = createFakePdfjs({ autoRender: true, numPages: 6, ...config });
  const pdf = { loadPdfjs: fake.loadPdfjs, workerSrc: "/pdf.worker.mjs" };
  return { fake, pdf };
}

const spread = (text: string) => screen.findByText(text);

describe("contents panel", () => {
  it("is offered only when asked for and only when the PDF has contents", async () => {
    const withContents = viewer({ outline: OUTLINE });
    const off = render(<FlipBook source="/doc.pdf" pdf={withContents.pdf} reducedMotion />);
    await spread("Pages 1–2 of 6");
    expect(screen.queryByRole("button", { name: "Contents" })).toBeNull();
    off.unmount();

    const none = viewer();
    const empty = render(<FlipBook source="/doc.pdf" pdf={none.pdf} reducedMotion outline />);
    await spread("Pages 1–2 of 6");
    // Give the contents time to load, then check that no button appeared.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole("button", { name: "Contents" })).toBeNull();
    empty.unmount();

    const on = viewer({ outline: OUTLINE });
    render(<FlipBook source="/doc.pdf" pdf={on.pdf} reducedMotion outline />);
    await spread("Pages 1–2 of 6");
    expect(await screen.findByRole("button", { name: "Contents" })).toBeTruthy();
  });

  it("lists the sections, marks the current one and keeps its parents open", async () => {
    const { pdf } = viewer({ outline: OUTLINE });
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion outline />);
    await spread("Pages 1–2 of 6");
    fireEvent.click(await screen.findByRole("button", { name: "Contents" }));

    const nav = screen.getByRole("navigation", { name: "Contents" });
    const inNav = within(nav);
    // Chapter 1 starts on page 1 and Section 1.1 on page 2, both on this spread: the section
    // started last is the one marked, and its parent is open so the mark can be seen.
    expect(inNav.getByRole("button", { name: /^Section 1.1/ }).getAttribute("aria-current")).toBe("location");
    expect(inNav.getByRole("button", { name: /^Chapter 1/ }).getAttribute("aria-current")).toBeNull();
    expect(inNav.getByRole("button", { name: "Collapse Chapter 1" }).getAttribute("aria-expanded")).toBe("true");
    expect(inNav.getByRole("button", { name: /^Chapter 2/ }).getAttribute("aria-current")).toBeNull();
    // Other sections are collapsed until opened.
    expect(inNav.queryByText("Section 2.1")).toBeNull();
    expect(inNav.getByRole("button", { name: "Expand Chapter 2" }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(inNav.getByRole("button", { name: "Expand Chapter 2" }));
    expect(inNav.getByText("Section 2.1")).toBeTruthy();
    expect(inNav.getByRole("button", { name: "Collapse Chapter 2" }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(inNav.getByRole("button", { name: /^Section 2.1/ }));
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
    expect(inNav.getByRole("button", { name: /^Section 2.1/ }).getAttribute("aria-current")).toBe("location");
    expect(inNav.getByRole("button", { name: /^Chapter 2/ }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps the chosen entry marked when two entries start on the same spread", async () => {
    const { pdf } = viewer({ outline: OUTLINE });
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion outline />);
    await spread("Pages 1–2 of 6");
    fireEvent.click(await screen.findByRole("button", { name: "Contents" }));
    const nav = within(screen.getByRole("navigation", { name: "Contents" }));
    fireEvent.click(nav.getByRole("button", { name: "Expand Chapter 2" }));

    // Pages 3 and 4 are one spread; Chapter 2 starts on 3 and Section 2.1 on 4.
    fireEvent.click(nav.getByRole("button", { name: /^Section 2.1/ }));
    expect(nav.getByRole("button", { name: /^Section 2.1/ }).getAttribute("aria-current")).toBe("location");
    fireEvent.click(nav.getByRole("button", { name: /^Chapter 2/ }));
    expect(nav.getByRole("button", { name: /^Chapter 2/ }).getAttribute("aria-current")).toBe("location");
    expect(nav.getByRole("button", { name: /^Section 2.1/ }).getAttribute("aria-current")).toBeNull();

    // Once the book moves on, the marker follows the reader again. Section 2.2 starts on page 5
    // and the Appendix on page 6, so the Appendix, started last, is the one marked.
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Pages 5–6 of 6");
    expect(nav.getByRole("button", { name: /^Appendix/ }).getAttribute("aria-current")).toBe("location");
    expect(nav.getByRole("button", { name: /^Chapter 2/ }).getAttribute("aria-current")).toBeNull();
    // Choosing Section 2.2 marks it for as long as page 5 is on screen.
    fireEvent.click(nav.getByRole("button", { name: /^Section 2.2/ }));
    expect(nav.getByRole("button", { name: /^Section 2.2/ }).getAttribute("aria-current")).toBe("location");
    expect(nav.getByRole("button", { name: /^Appendix/ }).getAttribute("aria-current")).toBeNull();
  });

  it("opens the parents of the section being read when the reader navigates elsewhere", async () => {
    const { pdf } = viewer({ outline: OUTLINE });
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} source="/doc.pdf" pdf={pdf} reducedMotion outline />);
    await spread("Pages 1–2 of 6");
    fireEvent.click(await screen.findByRole("button", { name: "Contents" }));
    const nav = within(screen.getByRole("navigation", { name: "Contents" }));
    expect(nav.queryByText("Section 2.2")).toBeNull();

    // Pages 3 and 4: Section 2.1 starts last, and Chapter 2 opens to show it.
    act(() => ref.current?.goToPage(4));
    expect(await nav.findByText("Section 2.1")).toBeTruthy();
    expect(nav.getByRole("button", { name: /^Section 2.1/ }).getAttribute("aria-current")).toBe("location");
    expect(nav.queryByText("Section 2.2")).toBeTruthy();
  });

  it("shows web entries as safe links and drops unsafe ones", async () => {
    const { pdf } = viewer({ outline: OUTLINE });
    render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion outline />);
    await spread("Pages 1–2 of 6");
    fireEvent.click(await screen.findByRole("button", { name: "Contents" }));
    const nav = within(screen.getByRole("navigation", { name: "Contents" }));

    const site = nav.getByRole("link", { name: /Website/ });
    expect(site.getAttribute("href")).toBe("https://example.com/");
    expect(site.getAttribute("target")).toBe("_blank");
    expect(site.getAttribute("rel")).toBe("noopener noreferrer");
    // The unsafe entry keeps its title but is not a link or button.
    expect(nav.getByText("Unsafe")).toBeTruthy();
    expect(nav.queryByRole("link", { name: /Unsafe/ })).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("exposes the contents through the controller with book page numbers", async () => {
    const { pdf } = viewer({ outline: OUTLINE });
    const ref = createRef<FlipBookController>();
    render(<FlipBook ref={ref} source="/doc.pdf" pdf={pdf} reducedMotion outline />);
    await spread("Pages 1–2 of 6");
    await screen.findByRole("button", { name: "Contents" });
    const items = await ref.current!.getOutline();
    expect(items.map((item) => [item.title, item.page])).toEqual([
      ["Chapter 1", 1],
      ["Chapter 2", 3],
      ["Appendix", 6],
      ["Website", null],
      ["Unsafe", null],
    ]);
    expect(items[1]?.items.map((item) => item.page)).toEqual([4, 5]);
  });

  it("maps contents onto the book when pages come from a PDF that starts later in the book", async () => {
    const { pdf } = viewer({ outline: OUTLINE });
    render(
      <FlipBook
        pages={[
          { type: "custom", render: () => <p>Front matter</p> },
          ...[1, 2, 3, 4, 5, 6].map((page) => ({ type: "pdf" as const, source: "/doc.pdf", page })),
        ]}
        pdf={pdf}
        reducedMotion
        outline
      />,
    );
    await screen.findByText("Pages 1–2 of 7");
    fireEvent.click(await screen.findByRole("button", { name: "Contents" }));
    const nav = within(screen.getByRole("navigation", { name: "Contents" }));
    fireEvent.click(nav.getByRole("button", { name: /^Appendix/ }));
    // PDF page 6 is book page 7.
    expect(screen.getByText("Page 7 of 7")).toBeTruthy();
  });
});

describe("PDF links", () => {
  const annotations = {
    1: [
      { subtype: "Link", rect: [72, 600, 200, 620], url: "https://example.com/a", newWindow: true },
      { subtype: "Link", rect: [72, 500, 200, 520], dest: [{ page: 4 }, { name: "Fit" }] },
      { subtype: "Link", rect: [72, 400, 200, 420], url: "javascript:alert(1)" },
    ],
  };

  const links = (container: HTMLElement) => container.querySelectorAll<HTMLAnchorElement>("[data-flipbook-link]");

  it("draws real links over the page: web links open in a new tab, internal links turn the book", async () => {
    const { pdf } = viewer({ annotations });
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />);
    await spread("Pages 1–2 of 6");
    await waitFor(() => expect(links(container).length).toBe(2));

    const web = screen.getByRole("link", { name: "Open link: https://example.com/a" });
    expect(web.getAttribute("href")).toBe("https://example.com/a");
    expect(web.getAttribute("target")).toBe("_blank");
    expect(web.getAttribute("rel")).toBe("noopener noreferrer");
    // The rectangle is a share of the page, so it scales with it.
    expect(web.style.left).toMatch(/^11\.7/);

    const internal = screen.getByRole("link", { name: "Go to page 4" });
    // The click is handled here, so the browser must not also follow the href.
    expect(fireEvent.click(internal)).toBe(false);
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("lets onLinkClick see and stop a link", async () => {
    const { pdf } = viewer({ annotations });
    const onLinkClick = vi.fn(() => false as const);
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onLinkClick={onLinkClick} />);
    await spread("Pages 1–2 of 6");
    await waitFor(() => expect(links(container).length).toBe(2));

    expect(fireEvent.click(screen.getByRole("link", { name: "Go to page 4" }))).toBe(false);
    expect(screen.getByText("Pages 1–2 of 6")).toBeTruthy();
    expect(onLinkClick).toHaveBeenLastCalledWith({ type: "page", page: 4 });

    expect(fireEvent.click(screen.getByRole("link", { name: /Open link/ }))).toBe(false);
    expect(onLinkClick).toHaveBeenLastCalledWith({ type: "url", url: "https://example.com/a" });
  });

  it("lets a link through when onLinkClick returns nothing", async () => {
    const { pdf } = viewer({ annotations });
    const onLinkClick = vi.fn();
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion onLinkClick={onLinkClick} />);
    await spread("Pages 1–2 of 6");
    await waitFor(() => expect(links(container).length).toBe(2));
    // Cancelled by the test so jsdom does not try to navigate.
    const web = screen.getByRole("link", { name: /Open link/ });
    web.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(web);
    expect(onLinkClick).toHaveBeenCalledWith({ type: "url", url: "https://example.com/a" });
    fireEvent.click(screen.getByRole("link", { name: "Go to page 4" }));
    expect(screen.getByText("Pages 3–4 of 6")).toBeTruthy();
  });

  it("draws no links when they are turned off", async () => {
    const { fake, pdf } = viewer({ annotations });
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion links={false} />);
    await spread("Pages 1–2 of 6");
    await waitFor(() => expect(container.querySelectorAll("canvas").length).toBe(2));
    expect(links(container).length).toBe(0);
    expect(fake.stats.annotationReads).toBe(0);
  });

  it("skips a link to a page that is not in the book", async () => {
    const { pdf } = viewer({ annotations: { 1: [{ subtype: "Link", rect: [72, 500, 200, 520], dest: [{ page: 9 }] }] } });
    const { container } = render(<FlipBook source="/doc.pdf" pdf={pdf} reducedMotion />);
    await spread("Pages 1–2 of 6");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(links(container).length).toBe(0);
  });
});

describe("hotspots", () => {
  const pages = Array.from({ length: 6 }, (_, index) => ({
    type: "custom" as const,
    render: () => <p>Content {index + 1}</p>,
  }));

  const onClick = vi.fn();
  const hotspots: FlipBookHotspot[] = [
    { id: "info", page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1, label: "Details", content: <p>Hello popover</p> },
    { id: "plain", page: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.2, label: "Click me", onClick },
    { id: "site", page: 2, x: 0.1, y: 0.1, width: 0.2, height: 0.2, label: "Visit", href: "https://example.com/" },
    { id: "later", page: 3, x: 0.1, y: 0.1, width: 0.2, height: 0.2, label: "On page three" },
  ];

  async function open(extra: Partial<React.ComponentProps<typeof FlipBook>> = {}) {
    const view = render(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion hotspots={hotspots} {...extra} />);
    await screen.findByText("Pages 1–2 of 6");
    return view;
  }

  it("draws a button or a link over the page, placed by fractions of the page", async () => {
    await open();
    const info = screen.getByRole("button", { name: "Details" });
    expect(info.style.left).toBe("10%");
    expect(info.style.top).toBe("20%");
    expect(info.style.width).toBe("30%");
    expect(info.style.height).toBe("10%");
    expect(info.getAttribute("aria-haspopup")).toBe("dialog");
    expect(info.getAttribute("aria-expanded")).toBe("false");

    // No popover content, so it does not claim to open one.
    expect(screen.getByRole("button", { name: "Click me" }).getAttribute("aria-haspopup")).toBeNull();

    const link = screen.getByRole("link", { name: "Visit" });
    expect(link.getAttribute("href")).toBe("https://example.com/");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    // Hotspots on pages that are not showing are not drawn.
    expect(screen.queryByRole("button", { name: "On page three" })).toBeNull();
  });

  it("calls onClick with the hotspot", async () => {
    onClick.mockClear();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: "plain" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a popover with the content, moves focus into it, and toggles shut", async () => {
    await open();
    const info = screen.getByRole("button", { name: "Details" });
    fireEvent.click(info);
    const dialog = screen.getByRole("dialog", { name: "Details" });
    expect(within(dialog).getByText("Hello popover")).toBeTruthy();
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    // A press inside must not start a page turn.
    expect(dialog.hasAttribute("data-flipbook-no-drag")).toBe(true);

    fireEvent.click(info);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(info.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from its button and puts focus back on the hotspot", async () => {
    await open();
    const info = screen.getByRole("button", { name: "Details" });
    fireEvent.click(info);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(info);
  });

  it("closes when the reader presses elsewhere, but not inside the popover", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(within(dialog).getByText("Hello popover"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only has one popover open at a time", async () => {
    const two: FlipBookHotspot[] = [
      { id: "a", page: 1, x: 0.1, y: 0.1, width: 0.1, height: 0.1, label: "A", content: "Alpha" },
      { id: "b", page: 1, x: 0.5, y: 0.1, width: 0.1, height: 0.1, label: "B", content: "Beta" },
    ];
    await open({ hotspots: two });
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "B" }));
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "B" })).toBeTruthy();
  });

  it("closes the popover when its page turns away", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Pages 3–4 of 6");
    expect(screen.queryByRole("dialog")).toBeNull();
    // And it stays closed on the way back.
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await screen.findByText("Pages 1–2 of 6");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the popover before the panel when Escape is pressed", async () => {
    const { container } = await open({ thumbnails: true });
    const root = container.querySelector('[role="region"]') as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Thumbnails" }));
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(root, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tabpanel")).toBeTruthy();

    fireEvent.keyDown(root, { key: "Escape" });
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("picks up hotspots that are added later", async () => {
    const view = await open({ hotspots: [] });
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    view.rerender(<FlipBook pages={pages} aspectRatio="3/4" reducedMotion hotspots={hotspots} />);
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
  });

  it("uses the locale for the default name and the close button", async () => {
    await open({
      hotspots: [{ id: "x", page: 1, x: 0, y: 0, width: 0.1, height: 0.1, content: "Body" }],
      locale: { hotspot: "Punto", closeHotspot: "Cerrar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Punto" }));
    expect(within(screen.getByRole("dialog", { name: "Punto" })).getByRole("button", { name: "Cerrar" })).toBeTruthy();
  });
});

describe("overlays", () => {
  const pages = Array.from({ length: 6 }, (_, index) => ({
    type: "custom" as const,
    render: () => <p>Content {index + 1}</p>,
  }));

  it("draws your React over a page, and a single element is clickable", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <FlipBook
        pages={pages}
        aspectRatio="3/4"
        reducedMotion
        overlays={{ 1: <button onClick={onClick}>Buy now</button>, 4: <span>Later</span> }}
      />,
    );
    await screen.findByText("Pages 1–2 of 6");
    const buy = screen.getByRole("button", { name: "Buy now" });
    expect(buy.style.pointerEvents).toBe("auto");
    // The layer itself lets everything through, so dragging still works.
    const layer = buy.closest("[data-flipbook-overlays]") as HTMLElement;
    expect(layer.style.pointerEvents).toBe("none");
    fireEvent.click(buy);
    expect(onClick).toHaveBeenCalledTimes(1);

    // Only pages on screen are drawn.
    expect(screen.queryByText("Later")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Pages 3–4 of 6");
    expect(screen.getByText("Later")).toBeTruthy();
    expect(container.querySelectorAll("[data-flipbook-overlay]")).toHaveLength(1);
  });

  it("keeps your styles on a clickable overlay", async () => {
    render(
      <FlipBook
        pages={pages}
        aspectRatio="3/4"
        reducedMotion
        overlays={{ 1: <button style={{ position: "absolute", left: 5, pointerEvents: "none" }}>Mine</button> }}
      />,
    );
    await screen.findByText("Pages 1–2 of 6");
    const mine = screen.getByRole("button", { name: "Mine" });
    expect(mine.style.left).toBe("5px");
    // What you set wins over the default.
    expect(mine.style.pointerEvents).toBe("none");
  });
});
