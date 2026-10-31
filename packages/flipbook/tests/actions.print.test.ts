// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPrintHtml,
  canvasToPrintable,
  createIframeFrame,
  printPages,
  type PrintFrame,
  type PrintSource,
  type PrintablePage,
} from "../src/actions/print.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeFrame() {
  const state = { shown: [] as PrintablePage[], title: "", printed: 0, disposed: 0 };
  let finishPrint: () => void = () => undefined;
  const frame: PrintFrame = {
    async show(pages, title) {
      state.shown = [...pages];
      state.title = title;
    },
    print() {
      state.printed += 1;
      return new Promise<void>((resolve) => {
        finishPrint = resolve;
      });
    },
    dispose() {
      state.disposed += 1;
      finishPrint();
    },
  };
  return { frame, state, closeDialog: () => finishPrint() };
}

function source(total: number, load: PrintSource["load"]): PrintSource {
  return { total, load };
}

describe("buildPrintHtml", () => {
  it("makes one sheet per page with no viewer markup, and escapes everything", () => {
    const html = buildPrintHtml([{ src: "a.jpg" }, { src: 'b".jpg?x=1&y=<2>' }], 'My "Book" <1>');
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
    expect(html).toContain("<title>My &quot;Book&quot; &lt;1&gt;</title>");
    expect(html).toContain('src="b&quot;.jpg?x=1&amp;y=&lt;2&gt;"');
    expect(html).toContain("@page { margin: 0; }");
    expect(html).not.toMatch(/flipbook/i);
  });
});

describe("printPages", () => {
  it("loads pages in order, one at a time, reports progress, then prints them all", async () => {
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const { frame, state, closeDialog } = fakeFrame();
    const progress: Array<[number, number]> = [];

    const job = printPages(
      source(3, async (index) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        order.push(`load:${index}`);
        active -= 1;
        return { src: `page-${index}.jpg` };
      }),
      { title: "Menu", onProgress: (done, total) => progress.push([done, total]) },
      () => frame,
    );
    await vi.waitFor(() => expect(state.printed).toBe(1));
    expect(order).toEqual(["load:0", "load:1", "load:2"]);
    expect(peak).toBe(1);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(state.title).toBe("Menu");
    expect(state.shown.map((p) => p.src)).toEqual(["page-0.jpg", "page-1.jpg", "page-2.jpg"]);

    closeDialog();
    await expect(job).resolves.toEqual({ printed: 3, skipped: 0 });
    expect(state.disposed).toBe(1);
  });

  it("releases every page and disposes the frame once printing is over", async () => {
    const released: number[] = [];
    const { frame, state, closeDialog } = fakeFrame();
    const job = printPages(
      source(2, async (index) => ({ src: `p${index}`, release: () => released.push(index) })),
      {},
      () => frame,
    );
    await vi.waitFor(() => expect(state.printed).toBe(1));
    expect(released).toEqual([]);
    closeDialog();
    await job;
    expect(released.sort()).toEqual([0, 1]);
  });

  it("skips a page that cannot be prepared and prints the rest", async () => {
    const { frame, state, closeDialog } = fakeFrame();
    const job = printPages(
      source(3, async (index) => {
        if (index === 1) throw new Error("render failed");
        return index === 2 ? null : { src: "ok" };
      }),
      {},
      () => frame,
    );
    await vi.waitFor(() => expect(state.printed).toBe(1));
    expect(state.shown).toHaveLength(1);
    closeDialog();
    await expect(job).resolves.toEqual({ printed: 1, skipped: 2 });
  });

  it("fails clearly when nothing can be printed, without opening a frame", async () => {
    const createFrame = vi.fn();
    await expect(printPages(source(2, async () => null), {}, createFrame)).rejects.toMatchObject({
      code: "PRINT_FAILED",
    });
    expect(createFrame).not.toHaveBeenCalled();
  });

  it("stops at once when aborted, and releases what was already prepared", async () => {
    const controller = new AbortController();
    const released: number[] = [];
    const loaded: number[] = [];
    const createFrame = vi.fn();
    const job = printPages(
      source(5, async (index, signal) => {
        loaded.push(index);
        if (index === 1) controller.abort();
        if (signal.aborted) throw Object.assign(new Error("x"), { name: "RenderingCancelledException" });
        return { src: `p${index}`, release: () => released.push(index) };
      }),
      { signal: controller.signal },
      createFrame,
    );
    await expect(job).rejects.toMatchObject({ name: "CancelledError" });
    expect(loaded).toEqual([0, 1]);
    expect(released).toEqual([0]);
    expect(createFrame).not.toHaveBeenCalled();
  });

  it("disposes the frame if aborted while the print dialog is open", async () => {
    const controller = new AbortController();
    const { frame, state } = fakeFrame();
    const job = printPages(source(1, async () => ({ src: "p" })), { signal: controller.signal }, () => frame);
    await vi.waitFor(() => expect(state.printed).toBe(1));
    controller.abort();
    await job;
    expect(state.disposed).toBeGreaterThanOrEqual(1);
  });

  it("is cancelled straight away by an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const load = vi.fn();
    await expect(printPages(source(3, load), { signal: controller.signal })).rejects.toMatchObject({
      name: "CancelledError",
    });
    expect(load).not.toHaveBeenCalled();
  });
});

describe("canvasToPrintable", () => {
  it("makes an object URL, frees the canvas at once, and revokes on release", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:print/1", revokeObjectURL: revoke }));
    const canvas = {
      width: 800,
      height: 1000,
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["jpeg"])),
    } as unknown as HTMLCanvasElement;

    const page = await canvasToPrintable(canvas);
    expect(page.src).toBe("blob:print/1");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    page.release?.();
    expect(revoke).toHaveBeenCalledWith("blob:print/1");
  });

  it("fails if the canvas cannot be encoded", async () => {
    const canvas = { width: 1, height: 1, toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement;
    await expect(canvasToPrintable(canvas)).rejects.toMatchObject({ code: "PRINT_FAILED" });
  });
});

describe("createIframeFrame", () => {
  it("writes the print document into a hidden iframe, prints when asked, and cleans up", async () => {
    // jsdom never loads images, so do not wait the full 20 s for them.
    const frame = createIframeFrame({ imageWaitMs: 10 });
    await frame.show([{ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }], "Doc");

    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("aria-hidden")).toBe("true");
    expect(iframe.contentDocument?.title).toBe("Doc");
    expect(iframe.contentDocument?.querySelectorAll(".sheet")).toHaveLength(1);

    const win = iframe.contentWindow as Window;
    win.print = vi.fn(() => {
      win.dispatchEvent(new Event("afterprint"));
    });
    await frame.print();
    expect(win.print).toHaveBeenCalledTimes(1);

    frame.dispose();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("dispose() while the dialog is open resolves the print promise", async () => {
    const frame = createIframeFrame({ imageWaitMs: 10 });
    await frame.show([{ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }], "Doc");
    const win = (document.querySelector("iframe") as HTMLIFrameElement).contentWindow as Window;
    win.print = vi.fn();
    const closed = frame.print();
    frame.dispose();
    await expect(closed).resolves.toBeUndefined();
  });
});
