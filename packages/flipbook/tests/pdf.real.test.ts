// Runs the real pdfjs-dist (legacy build, no browser) against generated PDFs.
// PDF.js 6 needs Node 22.13 or newer.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PdfManager } from "../src/pdf/manager.js";
import type { PdfOptions, PdfSource } from "../src/pdf/types.js";
import { SearchController } from "../src/core/search/SearchController.js";
import { bluePage, makePdf, redPage, text } from "./helpers/makePdf.js";
import { settle } from "./helpers/fakePdfjs.js";

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const supported = major > 22 || (major === 22 && minor >= 13);

const require = createRequire(import.meta.url);
const workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;

describe.skipIf(!supported)("real pdf.js", () => {
  let createCanvas: (width: number, height: number) => HTMLCanvasElement;
  const managers: PdfManager[] = [];

  beforeAll(async () => {
    const napi = await import("@napi-rs/canvas");
    createCanvas = (width, height) => napi.createCanvas(width, height) as unknown as HTMLCanvasElement;
  });

  afterEach(() => {
    for (const manager of managers.splice(0)) manager.dispose();
  });

  function open(source: PdfSource, options: PdfOptions = {}) {
    const resolved: PdfOptions = {
      loadPdfjs: () => import("pdfjs-dist/legacy/build/pdf.mjs"),
      workerSrc,
      ...options,
    };
    const manager = new PdfManager(
      { options: () => resolved, events: () => ({}), cacheSize: () => 10 },
      { createCanvas, getDevicePixelRatio: () => 1 },
    );
    managers.push(manager);
    manager.setViewportWidth(306);
    manager.sync([source]);
    const session = manager.getSession(source);
    if (!session) throw new Error("no session");
    return { manager, session };
  }

  const ready = async (source: PdfSource, options?: PdfOptions) => {
    const opened = open(source, options);
    for (let i = 0; i < 200 && opened.session.getSnapshot().status === "loading"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return opened;
  };

  const pixel = (canvas: HTMLCanvasElement, x: number, y: number): number[] => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no context");
    return Array.from(context.getImageData(x, y, 1, 1).data);
  };

  const twoPagePdf = () => makePdf([redPage, bluePage]);

  it("opens a PDF from bytes and reads its page count and size", async () => {
    const { session } = await ready(twoPagePdf());
    expect(session.getSnapshot()).toMatchObject({
      status: "ready",
      numPages: 2,
      firstPageSize: { width: 612, height: 792 },
    });
  });

  it("really renders pages: page 1 is red, page 2 is blue", async () => {
    const { session } = await ready(twoPagePdf());
    const one = await session.request(1, { position: 1, cssWidth: 306 });
    const two = await session.request(2, { position: 2, cssWidth: 306 });
    expect(one.scale).toBe(0.5);
    expect([one.width, one.height]).toEqual([306, 396]);
    expect(pixel(one.canvas, 153, 198).slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixel(two.canvas, 153, 198).slice(0, 3)).toEqual([0, 0, 255]);
    // The margin outside the rectangle stays white.
    expect(pixel(one.canvas, 5, 5).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("renders sharper when asked for a bigger slot", async () => {
    const { manager, session } = await ready(twoPagePdf());
    const small = await session.request(1, { position: 1, cssWidth: 306 });
    manager.setViewportWidth(612);
    const large = await session.request(1, { position: 1, cssWidth: 612 });
    expect(large.width).toBe(small.width * 2);
    expect(pixel(large.canvas, 306, 396).slice(0, 3)).toEqual([255, 0, 0]);
  });

  it("renders a real thumbnail, and a one-off high-resolution page for printing", async () => {
    const { manager, session } = await ready(twoPagePdf());
    const thumb = await session.requestThumbnail(2, { position: 2, cssWidth: 100 }).promise;
    expect(thumb.width).toBeLessThan(120);
    expect(pixel(thumb.canvas, Math.floor(thumb.width / 2), Math.floor(thumb.height / 2)).slice(0, 3)).toEqual([0, 0, 255]);
    expect(manager.thumbnailCache.size).toBe(1);

    const print = await session.renderOnce(1, 1);
    expect([print.width, print.height]).toEqual([612, 792]);
    expect(pixel(print.canvas, 306, 396).slice(0, 3)).toEqual([255, 0, 0]);
    expect(manager.cache.size).toBe(0);
  });

  it("opens a Blob without detaching the caller's data", async () => {
    const bytes = twoPagePdf();
    const { session } = await ready(new Blob([bytes as BlobPart]));
    expect(session.getSnapshot().numPages).toBe(2);
  });

  it("opens an ArrayBuffer and leaves the caller's buffer intact", async () => {
    const bytes = twoPagePdf();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const length = buffer.byteLength;
    const { session } = await ready(buffer);
    expect(session.getSnapshot().numPages).toBe(2);
    expect(buffer.byteLength).toBe(length);
  });

  it("reports a file that is not a PDF as INVALID_PDF", async () => {
    const { session } = await ready(new TextEncoder().encode("this is not a pdf at all"));
    expect(session.getSnapshot()).toMatchObject({ status: "error", error: { code: "INVALID_PDF" } });
  });

  describe("text, links and contents (real pdf.js)", () => {
    const richPdf = () =>
      makePdf(
        [
          {
            content: text("Hello World", 72, 700) + text("Second line of text", 72, 650),
            links: [
              { rect: [72, 500, 200, 520], url: "https://example.com/a" },
              { rect: [72, 450, 200, 470], page: 3 },
              { rect: [72, 400, 200, 420], dest: "chapter2" },
              { rect: [72, 350, 200, 370], url: "javascript:alert(1)" },
            ],
          },
          { content: text("Page two mentions world again", 72, 700) },
          { content: text("Chapter Two", 72, 700) },
        ],
        {
          outline: [
            { title: "Chapter 1", page: 1, children: [{ title: "Section 1.1", page: 2 }] },
            { title: "Chapter 2", page: 3 },
          ],
          destinations: { chapter2: 3 },
        },
      );

    it("extracts a page's text and locates a match on the page", async () => {
      const { session } = await ready(richPdf());
      const page = await session.getPageText(1);
      expect(page?.text).toContain("Hello World");
      expect(page?.text).toContain("Second line of text");

      const { compileQuery, findMatches } = await import("../src/core/search/text.js");
      const [match] = findMatches(page as NonNullable<typeof page>, compileQuery("world") as RegExp);
      const rect = match?.rects[0];
      // "World" is the second word of a line drawn at x=72, baseline y=700 on a 612x792 page.
      expect(rect?.x).toBeGreaterThan(0.2);
      expect(rect?.x).toBeLessThan(0.3);
      expect(rect?.y).toBeGreaterThan(0.08);
      expect(rect?.y).toBeLessThan(0.12);
      expect(rect?.height).toBeGreaterThan(0.015);
      expect(rect?.height).toBeLessThan(0.04);
      expect((rect?.width ?? 0) * 612).toBeGreaterThan(30);
      expect((rect?.width ?? 0) * 612).toBeLessThan(70);
    });

    it("searches the whole document with the real text", async () => {
      const { session } = await ready(richPdf());
      const search = new SearchController();
      search.setSource({ total: 3, getText: (position, signal) => session.getPageText(position, signal) });
      const done = await search.search("WORLD");
      expect(done.results.map((r) => [r.position, r.match])).toEqual([
        [1, "World"],
        [2, "world"],
      ]);
      expect(done.results[1]?.before).toContain("Page two mentions");
      expect(search.getHighlights().get(2)?.[0]?.rect.width).toBeGreaterThan(0);
    });

    it("finds links, resolving internal and named destinations and dropping unsafe addresses", async () => {
      const { session } = await ready(richPdf());
      const links = await session.getLinks(1);
      expect(links.map((l) => [l.kind, l.page, l.url])).toEqual([
        ["url", null, "https://example.com/a"],
        ["page", 3, null],
        ["page", 3, null],
      ]);
      const first = links[0]?.rect;
      expect(first?.x).toBeCloseTo(72 / 612, 3);
      expect(first?.y).toBeCloseTo((792 - 520) / 792, 3);
      expect(first?.width).toBeCloseTo(128 / 612, 3);
      expect(first?.height).toBeCloseTo(20 / 792, 3);
      expect(await session.getLinks(2)).toEqual([]);
    });

    it("reads the PDF's own table of contents", async () => {
      const { session } = await ready(richPdf());
      const outline = await session.getOutline();
      expect(outline.map((item) => [item.title, item.page])).toEqual([
        ["Chapter 1", 1],
        ["Chapter 2", 3],
      ]);
      expect(outline[0]?.items.map((item) => [item.title, item.page])).toEqual([["Section 1.1", 2]]);
    });

    it("reports no contents for a PDF without any", async () => {
      const { session } = await ready(makePdf([redPage]));
      expect(await session.getOutline()).toEqual([]);
      expect(await session.getLinks(1)).toEqual([]);
    });
  });

  describe("encrypted PDF (password: secret)", () => {
    const encrypted = () => new Uint8Array(readFileSync(new URL("./fixtures/encrypted.pdf", import.meta.url)));
    const waitFor = async (session: { getSnapshot(): { status: string } }, status: string) => {
      for (let i = 0; i < 200 && session.getSnapshot().status !== status; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };

    it("asks for a password, rejects a wrong one, accepts the right one, then renders", async () => {
      const { manager, session } = open(encrypted());
      await waitFor(session, "password");
      expect(session.getSnapshot()).toMatchObject({ status: "password", passwordReason: "needed" });
      expect(manager.getPasswordRequest()?.reason).toBe("needed");

      session.submitPassword("wrong");
      for (let i = 0; i < 200 && session.getSnapshot().passwordReason !== "incorrect"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(session.getSnapshot()).toMatchObject({ status: "password", passwordReason: "incorrect" });

      session.submitPassword("secret");
      await waitFor(session, "ready");
      expect(session.getSnapshot()).toMatchObject({ status: "ready", numPages: 2 });
      const page = await session.request(1, { position: 1, cssWidth: 306 });
      expect(pixel(page.canvas, 153, 198).slice(0, 3)).toEqual([255, 0, 0]);
    });

    it("opens without a prompt when the password is supplied up front", async () => {
      const { session } = await ready(encrypted(), { password: "secret" });
      expect(session.getSnapshot().status).toBe("ready");
    });

    it("ends in PASSWORD_REQUIRED when the prompt is cancelled", async () => {
      const { session } = open(encrypted());
      await waitFor(session, "password");
      session.submitPassword(null);
      await waitFor(session, "error");
      expect(session.getSnapshot()).toMatchObject({ status: "error", error: { code: "PASSWORD_REQUIRED" } });
    });
  });

  describe("over HTTP", () => {
    let server: Server;
    let base = "";

    beforeAll(async () => {
      const pdf = Buffer.from(twoPagePdf());
      server = createServer((request, response) => {
        if (request.url === "/ok.pdf") {
          response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.length });
          response.end(pdf);
        } else if (request.url === "/boom.pdf") {
          response.writeHead(500).end("server error");
        } else {
          response.writeHead(404).end("not found");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("loads a PDF from a URL", async () => {
      const { session } = await ready(`${base}/ok.pdf`);
      expect(session.getSnapshot()).toMatchObject({ status: "ready", numPages: 2, progress: 1 });
    });

    it("maps a 404 to PDF_NOT_FOUND", async () => {
      const { session } = await ready(`${base}/missing.pdf`);
      expect(session.getSnapshot().error?.code).toBe("PDF_NOT_FOUND");
    });

    it("maps a 500 to NETWORK_ERROR", async () => {
      const { session } = await ready(`${base}/boom.pdf`);
      expect(session.getSnapshot().error?.code).toBe("NETWORK_ERROR");
    });
  });

  it("settles cleanly when the manager is disposed mid-render", async () => {
    const { manager, session } = await ready(twoPagePdf());
    const pending = session.request(1, { position: 1, cssWidth: 306 });
    manager.dispose();
    await expect(pending).rejects.toMatchObject({ name: "CancelledError" });
    await settle();
    expect(manager.cache.size).toBe(0);
  });
  it("tears down a loaded document, and one that is still loading, without errors", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const loaded = await ready(twoPagePdf());
      expect(loaded.session.getSnapshot().status).toBe("ready");
      expect(() => loaded.manager.dispose()).not.toThrow();

      const loading = open(twoPagePdf());
      expect(() => loading.manager.dispose()).not.toThrow();
      // Let a document that was already on its way arrive and be dropped.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // The demo's guide.pdf is generated by a script; check it with the same code the viewer uses.
  const guidePath = new URL("../../../demo/next-app/public/guide.pdf", import.meta.url);
  describe.skipIf(!existsSync(guidePath))("the demo guide.pdf", () => {
    const guide = () => new Uint8Array(readFileSync(guidePath));

    it("has a nested table of contents that points at the right pages", async () => {
      const { session } = await ready(guide());
      expect(session.getSnapshot().numPages).toBe(10);
      const outline = await session.getOutline();
      expect(outline.map((item) => [item.title, item.page, item.items.map((child) => [child.title, child.page])])).toEqual([
        ["Planning the journey", 3, [["Packing light", 4]]],
        ["Getting around", 5, [["Trains", 6]]],
        ["Eating well", 7, [["Markets", 8]]],
        ["Coming home", 9, []],
      ]);
    });

    it("links its contents page to the chapters, and its back cover to the web", async () => {
      const { session } = await ready(guide());
      const contents = await session.getLinks(2);
      expect(contents.map((link) => [link.kind, link.page])).toEqual(
        [3, 4, 5, 6, 7, 8, 9].map((page) => ["page", page]),
      );
      const back = await session.getLinks(10);
      expect(back.map((link) => [link.kind, link.url])).toEqual([["url", "https://example.com/slow-travel"]]);
    });

    it("can be searched", async () => {
      const { session } = await ready(guide());
      const search = new SearchController();
      search.setSource({ total: 10, getText: (position, signal) => session.getPageText(position, signal) });
      const done = await search.search("night train");
      expect(done.results.length).toBeGreaterThanOrEqual(2);
      const journey = await search.search("journey");
      const perPage = new Map<number, number>();
      for (const result of journey.results) perPage.set(result.position, (perPage.get(result.position) ?? 0) + 1);
      expect([...perPage.entries()].sort((a, b) => a[0] - b[0])).toEqual([
        [2, 1],
        [3, 2],
        [4, 1],
        [5, 1],
        [9, 2],
      ]);
    });
  });
});
