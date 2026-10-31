import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfManager } from "../src/pdf/manager.js";
import type { PdfSessionEvents } from "../src/pdf/session.js";
import type { PdfOptions, PdfSource } from "../src/pdf/types.js";
import { createFakePdfjs, fakeCanvas, settle, type FakePdfConfig } from "./helpers/fakePdfjs.js";

const managers: PdfManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
});

function setup(config: FakePdfConfig = {}, options: PdfOptions = {}, events: PdfSessionEvents = {}, cacheSize = 10) {
  const fake = createFakePdfjs(config);
  const resolved: PdfOptions = { loadPdfjs: fake.loadPdfjs, workerSrc: "/worker.mjs", ...options };
  const manager = new PdfManager(
    { options: () => resolved, events: () => events, cacheSize: () => cacheSize },
    { createCanvas: fakeCanvas, getDevicePixelRatio: () => 1 },
  );
  managers.push(manager);
  const open = async (source: PdfSource = "/doc.pdf") => {
    manager.sync([source]);
    await settle();
    const session = manager.getSession(source);
    if (!session) throw new Error("session was not opened");
    return session;
  };
  manager.setViewportWidth(306); // 612pt page at 1x -> scale 0.5
  return { fake, manager, open };
}

describe("loading", () => {
  it("opens a document and reports its size", async () => {
    const onDocumentLoaded = vi.fn();
    const { open } = setup({ numPages: 9 }, {}, { onDocumentLoaded });
    const session = await open();
    expect(session.getSnapshot()).toMatchObject({
      status: "ready",
      numPages: 9,
      firstPageSize: { width: 612, height: 792 },
      error: null,
    });
    expect(onDocumentLoaded).toHaveBeenCalledWith({ numPages: 9 });
  });

  it("reports download progress, then completes", async () => {
    const { manager } = setup({ progress: { loaded: 25, total: 100 } });
    manager.sync(["/doc.pdf"]);
    const session = manager.getSession("/doc.pdf");
    const seen: Array<number | null> = [];
    session?.subscribe(() => seen.push(session.getSnapshot().progress));
    await settle();
    expect(seen).toContain(0.25);
    expect(session?.getSnapshot()).toMatchObject({ status: "ready", progress: 1 });
  });

  it("passes the source to PDF.js: URL as url, Blob and ArrayBuffer as data", async () => {
    const { fake, open } = setup();
    await open("/doc.pdf");
    await open(new Blob([new Uint8Array([1, 2, 3])]));
    const buffer = new Uint8Array([4, 5]).buffer;
    await open(buffer);
    expect(fake.stats.initCalls[0]).toMatchObject({ url: "/doc.pdf" });
    expect(Array.from(fake.stats.initCalls[1]?.data ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(fake.stats.initCalls[2]?.data ?? [])).toEqual([4, 5]);
    expect(buffer.byteLength).toBe(2);
  });

  it("applies the configured worker", async () => {
    const { fake, open } = setup({}, { workerSrc: "/custom.worker.mjs" });
    await open();
    expect(fake.pdfjs.GlobalWorkerOptions.workerSrc).toBe("/custom.worker.mjs");
  });

  it("maps load failures to structured errors", async () => {
    const invalid = setup({ loadError: Object.assign(new Error("bad"), { name: "InvalidPDFException" }) });
    expect((await invalid.open()).getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "INVALID_PDF" },
    });

    const missing = setup({
      loadError: Object.assign(new Error("nf"), { name: "ResponseException", status: 404, missing: true }),
    });
    expect((await missing.open()).getSnapshot().error?.code).toBe("PDF_NOT_FOUND");

    const offline = setup({ loadError: new TypeError("Failed to fetch") });
    expect((await offline.open()).getSnapshot().error?.code).toBe("NETWORK_ERROR");
  });
});

describe("passwords", () => {
  it("asks, rejects a wrong password, then accepts the right one", async () => {
    const { manager, open } = setup({ password: "secret" });
    const session = await open();
    expect(session.getSnapshot()).toMatchObject({ status: "password", passwordReason: "needed" });
    expect(manager.getPasswordRequest()?.reason).toBe("needed");
    const firstId = manager.getPasswordRequest()?.id;

    session.submitPassword("nope");
    await settle();
    expect(session.getSnapshot()).toMatchObject({ status: "password", passwordReason: "incorrect" });
    expect(manager.getPasswordRequest()?.id).not.toBe(firstId);

    session.submitPassword("secret");
    await settle();
    expect(session.getSnapshot()).toMatchObject({ status: "ready", passwordReason: null });
    expect(manager.getPasswordRequest()).toBeNull();
  });

  it("tries the configured password first", async () => {
    const { fake, open } = setup({ password: "secret" }, { password: "secret" });
    expect((await open()).getSnapshot().status).toBe("ready");
    expect(fake.stats.initCalls[0]?.password).toBe("secret");
  });

  it("ends in PASSWORD_REQUIRED when the prompt is cancelled", async () => {
    const { fake, open } = setup({ password: "secret" });
    const session = await open();
    session.submitPassword(null);
    await settle();
    expect(session.getSnapshot()).toMatchObject({ status: "error", error: { code: "PASSWORD_REQUIRED" } });
    expect(fake.stats.tasksDestroyed).toBe(1);
  });
});

describe("rendering", () => {
  it("renders at a scale that fits the slot and caches the result", async () => {
    const onPageLoaded = vi.fn();
    const { fake, open } = setup({ autoRender: true }, {}, { onPageLoaded });
    const session = await open();

    const first = await session.request(2, { position: 2, cssWidth: 306 });
    expect(first.scale).toBe(0.5);
    expect(first.width).toBe(306);
    expect(first.height).toBe(396);
    expect(onPageLoaded).toHaveBeenCalledWith(2);

    const again = await session.request(2, { position: 2, cssWidth: 306 });
    expect(again).toBe(first);
    expect(fake.renders).toHaveLength(1);
    expect(session.peek(2, 306)).toEqual({ render: first, exact: true });
  });

  it("shares one render between concurrent requests", async () => {
    const { fake, open } = setup();
    const session = await open();
    const a = session.request(1, { position: 1, cssWidth: 306 });
    const b = session.request(1, { position: 1, cssWidth: 306 });
    await settle();
    expect(fake.renders).toHaveLength(1);
    fake.renders[0]?.finish();
    expect(await a).toBe(await b);
  });

  it("offers another resolution as a placeholder while the right one renders", async () => {
    const { manager, open } = setup({ autoRender: true });
    const session = await open();
    const small = await session.request(1, { position: 1, cssWidth: 306 });
    manager.setViewportWidth(612);
    const peek = session.peek(1, 612);
    expect(peek).toEqual({ render: small, exact: false });
  });

  it("limits concurrent renders and serves the nearest pages first", async () => {
    const { fake, manager, open } = setup({}, { maxConcurrentRenders: 1 });
    await open();
    const resolve = (position: number) => ({ source: "/doc.pdf", page: position });

    manager.focus({ visible: [1], total: 6, radius: 2, resolve });
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1]);

    // The reader jumps away: queued prefetches for 2 and 3 are dropped.
    manager.focus({ visible: [6], total: 6, radius: 1, resolve });
    fake.renders[0]?.finish();
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1, 6]);
    fake.renders[1]?.finish();
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1, 6, 5]);
  });

  it("runs several renders at once up to the limit", async () => {
    const { fake, manager, open } = setup({}, { maxConcurrentRenders: 2 });
    await open();
    manager.focus({
      visible: [1],
      total: 6,
      radius: 3,
      resolve: (position) => ({ source: "/doc.pdf", page: position }),
    });
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1, 2]);
    fake.renders[0]?.finish();
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1, 2, 3]);
  });

  it("evicts far pages, zeroes their canvases, and keeps the page on screen", async () => {
    const { manager, open } = setup({ autoRender: true }, {}, {}, 2);
    const session = await open();
    manager.cache.setFocus(1);
    // Asked for directly, three pages do not fit in a cache of two; the farthest is evicted.
    await session.request(1, { position: 1, cssWidth: 306 });
    await session.request(2, { position: 2, cssWidth: 306 });
    const farthest = await session.request(3, { position: 3, cssWidth: 306 });
    expect(manager.cache.size).toBe(2);
    expect(session.peek(1, 306)?.exact).toBe(true);
    expect(session.peek(2, 306)?.exact).toBe(true);
    expect(session.peek(3, 306)).toBeNull();
    // Shrinking the canvas is what frees its pixels.
    expect(farthest.canvas.width).toBe(0);
    expect(manager.cache.stats().evictions).toBe(1);
  });

  it("does not prefetch more pages than a small cache can hold", async () => {
    const { fake, manager, open } = setup({ autoRender: true }, {}, {}, 2);
    await open();
    manager.focus({
      visible: [1],
      total: 6,
      radius: 2,
      resolve: (position) => ({ source: "/doc.pdf", page: position }),
    });
    await settle();
    // The page on screen and one beside it fill the cache; a third would only push one out.
    expect(fake.renders.map((r) => r.docPage).sort()).toEqual([1, 2]);
    expect(manager.cache.stats().evictions).toBe(0);
  });

  it("never evicts a canvas that is attached to the document", async () => {
    const { manager, open } = setup({ autoRender: true }, {}, {}, 1);
    const session = await open();
    const attached = await session.request(1, { position: 1, cssWidth: 306 });
    (attached.canvas as { isConnected: boolean }).isConnected = true;
    manager.cache.setFocus(6);
    await session.request(6, { position: 6, cssWidth: 306 });
    expect(attached.canvas.width).toBeGreaterThan(0);
    expect(manager.cache.has(session.keyFor(1, 306) ?? "")).toBe(true);
  });

  it("reports a page that fails without breaking the others", async () => {
    const onPageError = vi.fn();
    const { open } = setup({ autoRender: true, failRenderOf: [2] }, {}, { onPageError });
    const session = await open();
    await expect(session.request(2, { position: 2, cssWidth: 306 })).rejects.toMatchObject({
      code: "PAGE_RENDER_FAILED",
      page: 2,
    });
    expect(onPageError).toHaveBeenCalledWith(expect.objectContaining({ code: "PAGE_RENDER_FAILED", page: 2 }));
    await expect(session.request(1, { position: 1, cssWidth: 306 })).resolves.toBeDefined();
  });

  it("rejects pages outside the document and requests before the PDF is ready", async () => {
    const { manager, open } = setup({ autoRender: true });
    const session = await open();
    await expect(session.request(99, { position: 99, cssWidth: 306 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    manager.sync([]);
    await expect(session.request(1, { position: 1, cssWidth: 306 })).rejects.toMatchObject({
      name: "CancelledError",
    });
  });
});

describe("cleanup", () => {
  it("cancels running renders, terminates the worker, and drops cached pages", async () => {
    const { fake, manager, open } = setup({}, { maxConcurrentRenders: 1 });
    const session = await open();
    const pending = session.request(1, { position: 1, cssWidth: 306 });
    const queued = session.request(2, { position: 2, cssWidth: 306 });
    await settle();
    expect(fake.renders).toHaveLength(1);

    manager.dispose();
    await settle();

    expect(fake.renders[0]?.cancelled).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "CancelledError" });
    await expect(queued).rejects.toMatchObject({ name: "CancelledError" });
    expect(fake.stats.tasksDestroyed).toBe(1);
    expect(manager.cache.size).toBe(0);
    expect(manager.getSession("/doc.pdf")).toBeUndefined();
  });

  it("closes documents that are no longer in the list and keeps the rest", async () => {
    const { fake, manager, open } = setup();
    await open("/a.pdf");
    await open("/b.pdf");
    manager.sync(["/b.pdf"]);
    await settle();
    expect(manager.getSession("/a.pdf")).toBeUndefined();
    expect(manager.getSession("/b.pdf")).toBeDefined();
    expect(fake.stats.tasksDestroyed).toBe(1);
  });

  it("never starts a worker for a document closed before PDF.js was asked to open it", async () => {
    const { fake, manager } = setup();
    manager.sync(["/slow.pdf"]);
    manager.sync([]);
    await settle();
    expect(fake.stats.initCalls).toHaveLength(0);
    expect(fake.stats.tasksDestroyed).toBe(0);
    expect(manager.getSession("/slow.pdf")).toBeUndefined();
  });

  it("terminates the worker of a document closed while it was still opening", async () => {
    const { fake, manager } = setup();
    manager.sync(["/slow.pdf"]);
    // Microtasks only: PDF.js has been asked to open the file, but it has not answered yet.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(fake.stats.initCalls).toHaveLength(1);
    manager.sync([]);
    await settle();
    expect(fake.stats.tasksDestroyed).toBe(1);
    expect(fake.stats.docsDestroyed).toBe(0);
  });

  it("can be reused after dispose, as React Strict Mode requires", async () => {
    const { manager, open } = setup({ autoRender: true });
    await open();
    manager.dispose();
    const session = await open();
    expect(session.getSnapshot().status).toBe("ready");
    await expect(session.request(1, { position: 1, cssWidth: 306 })).resolves.toBeDefined();
  });
});

describe("thumbnails", () => {
  it("renders small, caches them apart from real pages, and returns the cached one next time", async () => {
    const { fake, manager, open } = setup({ autoRender: true });
    const session = await open();
    const request = session.requestThumbnail(2, { position: 2, cssWidth: 100 });
    const thumb = await request.promise;
    expect(thumb.width).toBeLessThan(150);
    expect(manager.thumbnailCache.size).toBe(1);
    expect(manager.cache.size).toBe(0);

    expect(session.peekThumbnail(2, 100)).toBe(thumb);
    const again = await session.requestThumbnail(2, { position: 2, cssWidth: 100 }).promise;
    expect(again).toBe(thumb);
    expect(fake.renders).toHaveLength(1);
  });

  it("never lets a thumbnail jump ahead of a real page", async () => {
    const { fake, manager, open } = setup({}, { maxConcurrentRenders: 1 });
    const session = await open();
    manager.cache.setFocus(1);
    const first = session.requestThumbnail(1, { position: 1, cssWidth: 100 });
    session.request(3, { position: 3, cssWidth: 306 }).catch(() => undefined);
    session.requestThumbnail(2, { position: 2, cssWidth: 100 });
    await settle();
    // The first thumbnail was already running; after it, the page must come before the next thumbnail.
    expect(fake.renders.map((r) => r.docPage)).toEqual([1]);
    fake.renders[0]?.finish();
    await first.promise;
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1, 3]);
    fake.renders[1]?.finish();
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1, 3, 2]);
  });

  it("drops a queued thumbnail that every requester gave up on", async () => {
    const { fake, manager, open } = setup({}, { maxConcurrentRenders: 1 });
    const session = await open();
    manager.cache.setFocus(1);
    session.request(1, { position: 1, cssWidth: 306 }).catch(() => undefined);
    await settle();
    const wanted = session.requestThumbnail(5, { position: 5, cssWidth: 100 });
    const scrolledAway = session.requestThumbnail(6, { position: 6, cssWidth: 100 });
    scrolledAway.cancel();
    await expect(scrolledAway.promise).rejects.toMatchObject({ name: "CancelledError" });
    fake.renders[0]?.finish();
    await settle();
    expect(fake.renders.map((r) => r.docPage)).toEqual([1, 5]);
    fake.renders[1]?.finish();
    await wanted.promise;
  });

  it("shares one render between requesters and only drops it when all cancel", async () => {
    const { fake, manager, open } = setup({}, { maxConcurrentRenders: 1 });
    const session = await open();
    manager.cache.setFocus(1);
    session.request(1, { position: 1, cssWidth: 306 }).catch(() => undefined);
    await settle();
    const a = session.requestThumbnail(4, { position: 4, cssWidth: 100 });
    const b = session.requestThumbnail(4, { position: 4, cssWidth: 100 });
    a.cancel();
    fake.renders[0]?.finish();
    await settle();
    expect(fake.renders.filter((r) => r.docPage === 4)).toHaveLength(1);
    fake.renders[1]?.finish();
    await expect(b.promise).resolves.toBeDefined();
  });

  it("does not report thumbnail work through page events", async () => {
    const onPageLoaded = vi.fn();
    const onPageError = vi.fn();
    const { open } = setup({ autoRender: true, failRenderOf: [3] }, {}, { onPageLoaded, onPageError });
    const session = await open();
    await session.requestThumbnail(1, { position: 1, cssWidth: 100 }).promise;
    await session.requestThumbnail(3, { position: 3, cssWidth: 100 }).promise.catch(() => undefined);
    expect(onPageLoaded).not.toHaveBeenCalled();
    expect(onPageError).not.toHaveBeenCalled();
  });

  it("rejects before the document is ready, outside the document, and after destroy", async () => {
    const { manager, open } = setup({ autoRender: true });
    const session = await open();
    await expect(session.requestThumbnail(99, { position: 99, cssWidth: 100 }).promise).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    manager.dispose();
    await expect(session.requestThumbnail(1, { position: 1, cssWidth: 100 }).promise).rejects.toBeDefined();
  });

  it("clears thumbnails when the document closes", async () => {
    const { manager, open } = setup({ autoRender: true });
    const session = await open();
    await session.requestThumbnail(1, { position: 1, cssWidth: 100 }).promise;
    manager.sync([]);
    expect(manager.thumbnailCache.size).toBe(0);
  });
});

describe("renderOnce (printing)", () => {
  it("renders at the requested scale without touching the cache or the queue", async () => {
    const { fake, manager, open } = setup({ autoRender: true });
    const session = await open();
    const rendered = await session.renderOnce(2, 2);
    expect(rendered.scale).toBe(2);
    expect(rendered.width).toBe(1224);
    expect(manager.cache.size).toBe(0);
    expect(fake.renders).toHaveLength(1);
    expect(fake.stats.pageCleanups).toBe(1);
  });

  it("caps the size like any other render", async () => {
    const { open } = setup({ autoRender: true }, { maxCanvasPixels: 1_000_000 });
    const session = await open();
    const rendered = await session.renderOnce(1, 10);
    expect(rendered.width * rendered.height).toBeLessThanOrEqual(1_010_000);
  });

  it("can be cancelled", async () => {
    const { fake, open } = setup();
    const session = await open();
    const controller = new AbortController();
    const job = session.renderOnce(1, 1, controller.signal);
    await settle();
    controller.abort();
    await expect(job).rejects.toMatchObject({ name: "RenderingCancelledException" });
    expect(fake.renders[0]?.cancelled).toBe(true);
  });

  it("rejects once the session is gone", async () => {
    const { manager, open } = setup({ autoRender: true });
    const session = await open();
    manager.dispose();
    await expect(session.renderOnce(1, 1)).rejects.toMatchObject({ name: "CancelledError" });
  });
});


describe("text, links and contents", () => {
  it("reads a page's text with where each run sits as fractions of the page", async () => {
    const { open } = setup({ text: { 2: [{ str: "Hello", x: 72, y: 700, width: 60, height: 12 }] } });
    const session = await open();
    const page = await session.getPageText(2);
    expect(page?.text).toBe("Hello");
    const rect = page?.runs[0]?.rect;
    expect(rect?.x).toBeCloseTo(72 / 612);
    expect(rect?.y).toBeCloseTo((792 - 712) / 792);
    expect(rect?.width).toBeCloseTo(60 / 612);
    expect(rect?.height).toBeCloseTo(12 / 792);
  });

  it("reads each page's text once, even when asked twice at the same time", async () => {
    const { fake, open } = setup({ text: { 1: "alpha" } });
    const session = await open();
    const [a, b] = await Promise.all([session.getPageText(1), session.getPageText(1)]);
    expect(a).toBe(b);
    await session.getPageText(1);
    expect(fake.stats.textReads).toBe(1);
  });

  it("gives nothing for a page outside the document, and stops when cancelled", async () => {
    const { fake, open } = setup({ text: { 1: "alpha" } });
    const session = await open();
    expect(await session.getPageText(99)).toBeNull();
    const controller = new AbortController();
    controller.abort();
    await expect(session.getPageText(1, controller.signal)).rejects.toMatchObject({ name: "CancelledError" });
    expect(fake.stats.textReads).toBe(0);
  });

  it("releases text when the document closes", async () => {
    const { manager, open } = setup({ text: { 1: "alpha" } });
    const session = await open();
    await session.getPageText(1);
    manager.dispose();
    await expect(session.getPageText(1)).rejects.toMatchObject({ name: "CancelledError" });
  });

  it("turns link annotations into rectangles, resolving internal ones to pages", async () => {
    const { open } = setup({
      annotations: {
        1: [
          { subtype: "Link", rect: [72, 500, 200, 520], url: "https://example.com/a", newWindow: true },
          { subtype: "Link", rect: [200, 450, 72, 470], dest: [{ page: 3 }, { name: "Fit" }] },
          { subtype: "Link", rect: [72, 400, 200, 420], dest: "chapter-2" },
          { subtype: "Link", rect: [72, 300, 200, 320], url: null, unsafeUrl: "javascript:alert(1)" },
          { subtype: "Link", rect: [72, 250, 200, 270], url: "javascript:alert(2)" },
          { subtype: "Link", rect: [72, 200, 200, 220], dest: [{ nonsense: true }] },
          { subtype: "Widget", rect: [0, 0, 10, 10] },
          { subtype: "Link" },
        ],
      },
      destinations: { "chapter-2": [{ page: 5 }, { name: "XYZ" }] },
    });
    const session = await open();
    const links = await session.getLinks(1);
    expect(links.map((l) => [l.kind, l.page, l.url])).toEqual([
      ["url", null, "https://example.com/a"],
      ["page", 3, null],
      ["page", 5, null],
    ]);
    expect(links[0]?.rect.x).toBeCloseTo(72 / 612);
    expect(links[0]?.rect.y).toBeCloseTo((792 - 520) / 792);
    expect(links[0]?.rect.width).toBeCloseTo(128 / 612);
    expect(links[0]?.rect.height).toBeCloseTo(20 / 792);
    // A rectangle given corner-to-corner the other way round is the same rectangle.
    expect(links[1]?.rect.x).toBeCloseTo(72 / 612);
    expect(links[1]?.rect.width).toBeCloseTo(128 / 612);
  });

  it("only follows web links with safe schemes", async () => {
    const { open } = setup({
      annotations: {
        1: ["http://a.test/", "https://b.test/", "mailto:x@y.test", "tel:+94110000000", "ftp://c.test/", "file:///etc/passwd", "data:text/html,hi", "/relative"].map(
          (url) => ({ subtype: "Link", rect: [0, 0, 1, 1], url }),
        ),
      },
    });
    const links = await (await open()).getLinks(1);
    expect(links.map((l) => l.url)).toEqual(["http://a.test/", "https://b.test/", "mailto:x@y.test", "tel:+94110000000"]);
  });

  it("reads each page's links once", async () => {
    const { fake, open } = setup({ annotations: { 1: [{ subtype: "Link", rect: [0, 0, 1, 1], url: "https://a.test/" }] } });
    const session = await open();
    await Promise.all([session.getLinks(1), session.getLinks(1)]);
    await session.getLinks(1);
    expect(fake.stats.annotationReads).toBe(1);
    expect(await session.getLinks(99)).toEqual([]);
  });

  it("builds the contents tree with pages resolved", async () => {
    const { fake, open } = setup({
      outline: [
        {
          title: "Chapter 1",
          bold: true,
          dest: [{ page: 1 }, { name: "Fit" }],
          items: [{ title: "Section 1.1", dest: [{ page: 2 }] }, { title: "Elsewhere", url: "https://a.test/", dest: null }],
        },
        { title: "Named", dest: "ch2", italic: true, items: [] },
        { title: "Broken", dest: [{ nonsense: 1 }] },
        { title: "Evil", url: "javascript:alert(1)" },
      ],
      destinations: { ch2: [{ page: 4 }] },
    });
    const session = await open();
    const outline = await session.getOutline();
    expect(outline).toEqual([
      {
        title: "Chapter 1",
        page: 1,
        url: null,
        bold: true,
        italic: false,
        items: [
          { title: "Section 1.1", page: 2, url: null, bold: false, italic: false, items: [] },
          { title: "Elsewhere", page: null, url: "https://a.test/", bold: false, italic: false, items: [] },
        ],
      },
      { title: "Named", page: 4, url: null, bold: false, italic: true, items: [] },
      { title: "Broken", page: null, url: null, bold: false, italic: false, items: [] },
      { title: "Evil", page: null, url: null, bold: false, italic: false, items: [] },
    ]);
    await session.getOutline();
    expect(fake.stats.outlineReads).toBe(1);
  });

  it("returns an empty list for a PDF with no contents, and caps a huge one", async () => {
    const none = await (await setup({}).open()).getOutline();
    expect(none).toEqual([]);
    const huge = Array.from({ length: 2100 }, (_, i) => ({ title: `Item ${i}`, dest: [{ page: 1 }] }));
    const capped = await (await setup({ outline: huge }).open()).getOutline();
    expect(capped).toHaveLength(2000);
  });
});
