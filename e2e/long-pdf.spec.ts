import { expect, test } from "./fixtures";

// /large-pdf: a generated 1000 page PDF with a live panel of what the viewer holds. These are not
// timings (see benchmarks/) but limits that must hold however long the document is: how many
// canvases exist, how many pages the caches keep, and that leaving the page leaves nothing running.
const CANVAS_LIMIT = 6; // the two visible pages and, while a turn is in flight, the two it uncovers

test.describe("a very long PDF", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/large-pdf?pages=1000");
    await page.waitForFunction(() => window.__flipbookBench?.firstPageAt != null);
  });

  test("keeps a bounded number of canvases and cached pages while reading and jumping", async ({ page }) => {
    let mostCanvases = 0;
    for (let turn = 0; turn < 12; turn += 1) {
      await page.evaluate(() => window.__flipbookBench!.controller()!.next());
      await page.waitForFunction(() => !window.__flipbookBench!.controller()!.isAnimating());
      mostCanvases = Math.max(mostCanvases, await page.locator("canvas").count());
    }
    for (const target of [640, 17, 903]) {
      await page.evaluate((to) => window.__flipbookBench!.controller()!.goToPage(to), target);
      await page.waitForFunction(() => !window.__flipbookBench!.controller()!.isAnimating());
      mostCanvases = Math.max(mostCanvases, await page.locator("canvas").count());
    }
    expect(mostCanvases).toBeLessThanOrEqual(CANVAS_LIMIT);

    const stats = await page.evaluate(() => window.__flipbookBench!.controller()!.getCacheStats());
    // cacheSize is 10, and the cache may hold one more while an entry is being replaced.
    expect(stats.pages.peakEntries).toBeLessThanOrEqual(11);
    expect(stats.pages.evictions).toBeGreaterThan(0);
  });

  test("draws the thumbnails near the page being read when the panel opens far into the book", async ({ book, page }) => {
    await page.evaluate(() => window.__flipbookBench!.controller()!.goToPage(400));
    await book.expectPage("Pages 400–401 of 1000");
    await book.button("Thumbnails").click();

    // The panel goes straight to page 400, not by gliding past hundreds of thumbnails.
    await expect(book.root.locator('[data-thumb-page="400"] canvas')).toBeVisible({ timeout: 5000 });
    await expect(book.root.locator('[data-thumb-page="401"] canvas')).toBeVisible();
    await expect.poll(() => book.root.locator("[data-thumb-page] canvas").count()).toBeLessThanOrEqual(14);

    // And it did not draw pictures for the pages it would have passed on the way.
    const stats = await page.evaluate(() => window.__flipbookBench!.controller()!.getCacheStats());
    expect(stats.thumbnails.entries).toBeLessThanOrEqual(20);
  });

  test("searches every page without stopping the page, and keeps the index bounded", async ({ book, page }) => {
    await book.focus();
    await page.keyboard.press("/");
    await book.root.getByRole("searchbox").fill("qwxz");
    await expect(book.root.getByText(/No results|No matches|Nothing found/i)).toBeVisible({ timeout: 30_000 });
    const stats = await page.evaluate(() => window.__flipbookBench!.controller()!.getCacheStats());
    expect(stats.text.pages).toBe(1000);
    // pdf.maxTextCacheBytes defaults to 32 MB.
    expect(stats.text.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  });

  test("leaves no PDF.js worker and no canvas behind when the reader moves on", async ({ page }) => {
    expect(page.workers().length).toBeGreaterThan(0);
    await page.evaluate(() => window.__flipbookBench!.controller()!.next());
    await page.getByRole("navigation", { name: "Demos" }).getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.workers().length).toBe(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await page.evaluate(() => window.__flipbookBench === undefined)).toBe(true);
  });
});
