// Behaviour that keeps a long document cheap: the prefetch window stays inside the cache,
// work for pages the reader has left is dropped, and memory that PDF.js and the search index
// would otherwise keep for every page visited is released.
import { afterEach, describe, expect, it } from "vitest";
import { estimateTextBytes } from "../src/core/search/text.js";
import { PdfManager } from "../src/pdf/manager.js";
import type { PdfOptions } from "../src/pdf/types.js";
import { createFakePdfjs, fakeCanvas, settle, type FakePdfConfig } from "./helpers/fakePdfjs.js";

const managers: PdfManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
});

const SOURCE = "/doc.pdf";
const resolve = (position: number) => ({ source: SOURCE, page: position });

function setup(config: FakePdfConfig = {}, options: PdfOptions = {}, cacheSize = 10) {
  const fake = createFakePdfjs(config);
  const resolved: PdfOptions = { loadPdfjs: fake.loadPdfjs, workerSrc: "/worker.mjs", ...options };
  const manager = new PdfManager(
    { options: () => resolved, events: () => ({}), cacheSize: () => cacheSize },
    { createCanvas: fakeCanvas, getDevicePixelRatio: () => 1 },
  );
  managers.push(manager);
  manager.setViewportWidth(306); // a 612pt page at scale 0.5
  const open = async () => {
    manager.sync([SOURCE]);
    await settle();
    const session = manager.getSession(SOURCE);
    if (!session) throw new Error("session was not opened");
    return session;
  };
  return { fake, manager, open };
}

const pagesRendered = (fake: ReturnType<typeof createFakePdfjs>): number[] =>
  fake.renders.map((render) => render.docPage).sort((a, b) => a - b);

describe("the prefetch window", () => {
  it("never asks for more pages than the cache can hold", async () => {
    const { fake, manager, open } = setup({ numPages: 20, autoRender: true }, {}, 6);
    await open();
    // Two pages on screen and eight either side would need 18 slots; there are 6.
    manager.focus({ visible: [3, 4], total: 20, radius: 8, resolve });
    await settle();
    expect(pagesRendered(fake)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(manager.cache.stats().evictions).toBe(0);
  });

  it("does not draw the same pages again when the focus is repeated", async () => {
    const { fake, manager, open } = setup({ numPages: 20, autoRender: true }, {}, 6);
    await open();
    for (let i = 0; i < 4; i += 1) {
      manager.focus({ visible: [3, 4], total: 20, radius: 8, resolve });
      await settle();
    }
    expect(fake.renders).toHaveLength(6);
  });

  it("always draws the pages on screen, even when they alone are more than the cache holds", async () => {
    const { fake, manager, open } = setup({ numPages: 20, autoRender: true }, {}, 1);
    await open();
    manager.focus({ visible: [3, 4], total: 20, radius: 4, resolve });
    await settle();
    expect(pagesRendered(fake)).toEqual([3, 4]);
  });

  it("stays inside the byte budget as well", async () => {
    // A page at this size is 306 x 396 x 4 = 484,704 bytes, so 1.5 MB holds three.
    const { fake, manager, open } = setup({ numPages: 20, autoRender: true }, { maxCacheBytes: 1_500_000 }, 50);
    await open();
    manager.focus({ visible: [5], total: 20, radius: 6, resolve });
    await settle();
    expect(pagesRendered(fake)).toEqual([4, 5, 6]);
  });

  it("uses the whole radius when the cache has room for it", async () => {
    const { fake, manager, open } = setup({ numPages: 20, autoRender: true }, {}, 20);
    await open();
    manager.focus({ visible: [10], total: 20, radius: 3, resolve });
    await settle();
    expect(pagesRendered(fake)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });
});

describe("leaving a page behind", () => {
  it("stops a prefetch that is already drawing when the reader jumps away", async () => {
    const { fake, manager, open } = setup({ numPages: 30 }, { maxConcurrentRenders: 2 });
    await open();
    manager.focus({ visible: [1], total: 30, radius: 2, resolve });
    await settle();
    expect(pagesRendered(fake)).toEqual([1, 2]);

    manager.focus({ visible: [20], total: 30, radius: 2, resolve });
    await settle();

    const page2 = fake.renders.find((render) => render.docPage === 2);
    const page1 = fake.renders.find((render) => render.docPage === 1);
    expect(page2?.cancelled).toBe(true);
    // The page that was on screen was not a prefetch; it is left to finish.
    expect(page1?.cancelled).toBe(false);
    // The freed slot goes straight to the page the reader jumped to.
    expect(pagesRendered(fake)).toContain(20);
  });

  it("serves a page again that was just stopped, instead of failing it", async () => {
    const { fake, manager, open } = setup({ numPages: 30 }, { maxConcurrentRenders: 2 });
    const session = await open();
    manager.focus({ visible: [1], total: 30, radius: 2, resolve });
    await settle();
    manager.focus({ visible: [20], total: 30, radius: 2, resolve });

    // Before the stopped render has finished unwinding, the reader comes back to page 2.
    const again = session.request(2, { position: 2, cssWidth: 306 });
    for (let i = 0; i < 8; i += 1) {
      for (const render of fake.renders) render.finish();
      await settle(2);
    }
    await expect(again).resolves.toMatchObject({ scale: 0.5 });
  });

  it("keeps the pages of the window and drops the rest of the queue", async () => {
    const { fake, manager, open } = setup({ numPages: 30 }, { maxConcurrentRenders: 1 });
    await open();
    manager.focus({ visible: [10], total: 30, radius: 2, resolve });
    await settle();
    manager.focus({ visible: [11], total: 30, radius: 2, resolve });
    for (let i = 0; i < 12; i += 1) {
      for (const render of fake.renders) render.finish();
      await settle(2);
    }
    // 9 is outside the new window (10..13) and was never drawn.
    expect(pagesRendered(fake)).not.toContain(8);
    expect(pagesRendered(fake)).toContain(11);
  });
});

describe("what the search index holds", () => {
  const manyItems = (page: number) =>
    Array.from({ length: 100 }, (_, i) => ({ str: `word${page}x${i}`, x: 10 + i, y: 700 - i, width: 30, height: 10 }));
  const text = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, manyItems(i + 1)]));

  async function pageBytes(): Promise<number> {
    const { open } = setup({ numPages: 20, text });
    const page = await (await open()).getPageText(1);
    if (!page) throw new Error("no text");
    return estimateTextBytes(page);
  }

  it("reports what it holds", async () => {
    const { open } = setup({ numPages: 20, text });
    const session = await open();
    expect(session.getMemoryStats()).toEqual({ textPages: 0, textBytes: 0 });
    await session.getPageText(1);
    await session.getPageText(2);
    const { textPages, textBytes } = session.getMemoryStats();
    expect(textPages).toBe(2);
    expect(textBytes).toBeGreaterThan(0);
  });

  it("stays inside its budget, however many pages are searched", async () => {
    const each = await pageBytes();
    const { fake, open } = setup({ numPages: 20, text }, { maxTextCacheBytes: Math.floor(each * 2.5) });
    const session = await open();
    for (let page = 1; page <= 20; page += 1) await session.getPageText(page);
    const { textPages, textBytes } = session.getMemoryStats();
    expect(textPages).toBe(2);
    expect(textBytes).toBeLessThanOrEqual(each * 2.5);
    expect(fake.stats.textReads).toBe(20);
  });

  it("drops the page that was used longest ago, and reads an evicted page again", async () => {
    const each = await pageBytes();
    const { fake, open } = setup({ numPages: 20, text }, { maxTextCacheBytes: Math.floor(each * 2.5) });
    const session = await open();
    await session.getPageText(9);
    await session.getPageText(10);
    await session.getPageText(9); // 9 is now the most recently used
    await session.getPageText(11); // pushes out 10, not 9
    expect(fake.stats.textReads).toBe(3);

    await session.getPageText(9);
    expect(fake.stats.textReads).toBe(3);
    await session.getPageText(10);
    expect(fake.stats.textReads).toBe(4);
  });

  it("always keeps the page just read, even when it alone is over budget", async () => {
    const { open } = setup({ numPages: 20, text }, { maxTextCacheBytes: 10 });
    const session = await open();
    const page = await session.getPageText(1);
    expect(page).not.toBeNull();
    expect(session.getMemoryStats().textPages).toBe(1);
  });
});

describe("releasing what PDF.js keeps for every page it has opened", () => {
  const readPages = async (
    session: Awaited<ReturnType<ReturnType<typeof setup>["open"]>>,
    count: number,
    from = 1,
  ) => {
    for (let page = from; page < from + count; page += 1) {
      await session.request(page, { position: page, cssWidth: 306 });
    }
    await settle();
  };

  it("cleans up once enough pages have been drawn and the queue is quiet", async () => {
    const { fake, open } = setup({ numPages: 60, autoRender: true }, { cleanupAfterPages: 10 }, 3);
    const session = await open();
    await readPages(session, 25);
    expect(fake.stats.cleanups).toBe(2);
    expect(fake.stats.cleanupWhileRendering).toBe(0);
    expect(fake.stats.workDuringCleanup).toBe(0);
  });

  it("does not clean up while pages are still queued or drawing", async () => {
    const { fake, open } = setup({ numPages: 60 }, { cleanupAfterPages: 5, maxConcurrentRenders: 2 }, 3);
    const session = await open();
    const requests = Array.from({ length: 12 }, (_, i) =>
      session.request(i + 1, { position: i + 1, cssWidth: 306 }),
    );
    await settle();
    expect(fake.stats.cleanups).toBe(0);

    for (let i = 0; i < 40; i += 1) {
      for (const render of fake.renders) render.finish();
      await settle(2);
    }
    await Promise.all(requests);
    expect(fake.stats.cleanups).toBe(1);
    expect(fake.stats.cleanupWhileRendering).toBe(0);
  });

  it("holds new work until the cleanup is done", async () => {
    const { fake, open } = setup({ numPages: 60, autoRender: true, text: { 12: "hello" } }, { cleanupAfterPages: 10 }, 3);
    const session = await open();
    await readPages(session, 9);
    // The tenth page finishes and the cleanup starts in the same breath.
    await session.request(10, { position: 10, cssWidth: 306 });
    const render = session.request(11, { position: 11, cssWidth: 306 });
    const read = session.getPageText(12);
    await settle();
    await expect(render).resolves.toBeDefined();
    await expect(read).resolves.toMatchObject({ text: "hello" });
    expect(fake.stats.cleanups).toBe(1);
    expect(fake.stats.workDuringCleanup).toBe(0);
  });

  it("counts pages whose text was read, not only pages that were drawn", async () => {
    const { fake, open } = setup({ numPages: 60 }, { cleanupAfterPages: 10 });
    const session = await open();
    for (let page = 1; page <= 25; page += 1) await session.getPageText(page);
    await settle();
    expect(fake.stats.cleanups).toBe(2);
    expect(fake.stats.workDuringCleanup).toBe(0);
  });

  it("can be turned off", async () => {
    const { fake, open } = setup({ numPages: 60, autoRender: true }, { cleanupAfterPages: 0 }, 3);
    const session = await open();
    await readPages(session, 30);
    expect(fake.stats.cleanups).toBe(0);
  });

  it("does nothing once the document is closed", async () => {
    const { fake, manager, open } = setup({ numPages: 60, autoRender: true }, { cleanupAfterPages: 3 }, 3);
    const session = await open();
    await readPages(session, 2);
    manager.dispose();
    const before = fake.stats.cleanups;
    await settle();
    expect(fake.stats.cleanups).toBe(before);
  });
});

describe("reporting memory", () => {
  it("adds up the page cache, the thumbnail cache and the search index", async () => {
    const { manager, open } = setup({ numPages: 10, autoRender: true, text: { 1: "hello world" } });
    const session = await open();
    expect(manager.getCacheStats()).toMatchObject({
      pages: { entries: 0, bytes: 0 },
      thumbnails: { entries: 0 },
      text: { pages: 0, bytes: 0 },
    });

    await session.request(1, { position: 1, cssWidth: 306 });
    await session.request(2, { position: 2, cssWidth: 306 });
    await session.requestThumbnail(3, { position: 3, cssWidth: 50 }).promise;
    await session.getPageText(1);

    const stats = manager.getCacheStats();
    expect(stats.pages.entries).toBe(2);
    expect(stats.pages.bytes).toBe(2 * 306 * 396 * 4);
    expect(stats.thumbnails.entries).toBe(1);
    expect(stats.text.pages).toBe(1);
    expect(stats.text.bytes).toBeGreaterThan(0);
  });
});
