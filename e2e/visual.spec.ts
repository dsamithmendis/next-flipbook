import type { Page } from "@playwright/test";
import { expect, test, type Book } from "./fixtures";

// Screenshots of the viewer, compared with the ones in e2e/visual.spec.ts-snapshots. They catch
// what the other tests cannot: a page turn that is correct but ugly, a toolbar that overlaps, a
// colour that went wrong in dark mode.
//
// Run them with `npm run e2e:visual`; `npm run e2e` leaves them out. A screenshot depends on the
// machine's fonts and the browser's build, so the committed ones are for Linux and Playwright's
// Chromium (see docs/testing.md). Regenerate with `npm run e2e:visual:update` and look at the
// pictures before committing them.
//
// Only the viewer is captured, never the demo page around it. The pages are SVG images and a
// generated PDF, so nothing in them changes from one run to the next.

async function settle(page: Book["page"]): Promise<void> {
  // A pointer left over a button shows its hover colour; keep it out of the corner of the page.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  // Let a turn or panel animation finish and the pictures arrive.
  await page.waitForTimeout(1000);
}

async function shoot(book: Book, name: string, tolerance = 0.01): Promise<void> {
  await settle(book.page);
  await expect(book.root).toHaveScreenshot(name, { maxDiffPixelRatio: tolerance, caret: "hide" });
}

async function open(page: Page, path: string, book: Book, ready: RegExp): Promise<void> {
  await page.goto(path);
  await expect(book.status).toHaveText(ready);
}

test.describe("the viewer looks as it should", { tag: "@visual" }, () => {
  test("images: the cover", async ({ page, book }) => {
    await open(page, "/images", book, /Page 1 of 10/);
    await shoot(book, "images-cover.png");
  });

  test("images: a spread", async ({ page, book }) => {
    await open(page, "/images", book, /Page 1 of 10/);
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    await shoot(book, "images-spread.png");
  });

  test("images: the last page", async ({ page, book }) => {
    await open(page, "/images", book, /Page 1 of 10/);
    await book.focus();
    await page.keyboard.press("End");
    await book.expectPage("Page 10 of 10");
    await shoot(book, "images-last.png");
  });

  test("images: a single page", async ({ page, book }) => {
    await open(page, "/single", book, /Page 1 of 10/);
    await book.next.click();
    await book.expectPage("Page 2 of 10");
    await shoot(book, "images-single.png");
  });

  test("right to left: a spread", async ({ page, book }) => {
    await open(page, "/rtl", book, /Page 1 of 10/);
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    await shoot(book, "rtl-spread.png");
  });

  test("PDF: a spread with the thumbnails open", async ({ page, book }) => {
    await open(page, "/features", book, /Page 1 of 12/);
    await book.button("Bookmark this page").click();
    await book.button("Thumbnails").click();
    await expect(book.root.getByRole("button", { name: /^Go to page 3/ })).toBeVisible();
    // PDF text is drawn by the browser with the fonts it has, so allow a little more difference.
    await shoot(book, "pdf-thumbnails.png", 0.03);
  });

  test("PDF: search with results", async ({ page, book }) => {
    await open(page, "/search", book, /Page 1 of 10/);
    await book.focus();
    await page.keyboard.press("/");
    await book.root.getByRole("searchbox").fill("train");
    await expect(book.root.getByRole("status").filter({ hasText: / of 8$/ })).toBeVisible();
    await shoot(book, "pdf-search.png", 0.03);
  });

  test("a hotspot popover", async ({ page, book }) => {
    await open(page, "/hotspots", book, /Page 1 of 10/);
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    await book.root.getByRole("button", { name: "About the morning light" }).click();
    await expect(book.root.getByText("Shot at 6:10")).toBeVisible();
    await shoot(book, "hotspot-popover.png");
  });

  // The theme is the `theme` prop, not the operating system's colour scheme, so the dark ones go
  // through the playground, which can switch it on for any content.
  test.describe("the dark theme", () => {
    test.beforeEach(async ({ page, book }) => {
      await page.goto("/playground");
      await book.expectPage("Page 1 of 10");
      await page.getByLabel("theme").selectOption("dark");
      await expect(book.root).toHaveAttribute("data-flipbook-theme", "dark");
    });

    test("images: a spread", async ({ page, book }) => {
      // The playground's viewer is narrow, so ask for two pages explicitly.
      await page.getByLabel("mode").selectOption("double");
      await book.next.click();
      await book.expectPage("Pages 2–3 of 10");
      await shoot(book, "dark-images-spread.png");
    });

    test("PDF: a spread with the thumbnails open", async ({ page, book }) => {
      await page.getByLabel("Show").selectOption("pdf");
      await book.expectPage("Page 1 of 10");
      await book.button("Thumbnails").click();
      await expect(book.root.getByRole("button", { name: /^Go to page 3/ })).toBeVisible();
      await shoot(book, "dark-pdf-thumbnails.png", 0.03);
    });
  });
});
