import { expect, test } from "./fixtures";

// Ten image pages with a cover: page 1 alone, then spreads 2–3, 4–5, 6–7, 8–9, and page 10 alone.
test.describe("turning pages", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/images");
  });

  test("opens on the cover, with nothing before it", async ({ book }) => {
    await book.expectPage("Page 1 of 10");
    await expect(book.root.getByRole("img", { name: "Demo page 1" })).toBeVisible();
    await expect(book.previous).toBeDisabled();
    await expect(book.next).toBeEnabled();
  });

  test("turns with the buttons", async ({ book }) => {
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    await expect(book.root.getByRole("img", { name: "Demo page 2" })).toBeVisible();
    await expect(book.root.getByRole("img", { name: "Demo page 3" })).toBeVisible();

    await book.previous.click();
    await book.expectPage("Page 1 of 10");
  });

  test("turns with the keyboard", async ({ book, page }) => {
    await book.focus();
    await page.keyboard.press("ArrowRight");
    await book.expectPage("Pages 2–3 of 10");
    await page.keyboard.press("ArrowRight");
    await book.expectPage("Pages 4–5 of 10");
    await page.keyboard.press("ArrowLeft");
    await book.expectPage("Pages 2–3 of 10");
    await page.keyboard.press("End");
    await book.expectPage("Page 10 of 10");
    await page.keyboard.press("Home");
    await book.expectPage("Page 1 of 10");
  });

  test("does not turn past either end", async ({ book, page }) => {
    await book.focus();
    await page.keyboard.press("ArrowLeft");
    await book.expectPage("Page 1 of 10");
    await page.keyboard.press("End");
    await book.expectPage("Page 10 of 10");
    await page.keyboard.press("ArrowRight");
    await book.expectPage("Page 10 of 10");
    await expect(book.next).toBeDisabled();
  });

  test("turns when a page is dragged across the book", async ({ book, page }) => {
    const box = await book.box();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.25, y, { steps: 8 });
    await page.mouse.up();
    await book.expectPage("Pages 2–3 of 10");
  });

  test("springs back when a page is let go early", async ({ book, page }) => {
    const box = await book.box();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 90, y, { steps: 4 });
    await page.mouse.up();
    // Give the spring time to settle, then check that it went back rather than forward.
    await page.waitForTimeout(1000);
    await book.expectPage("Page 1 of 10");
  });

  test("shows one page at a time in a narrow window", async ({ book, page }) => {
    await page.setViewportSize({ width: 560, height: 900 });
    await book.expectPage("Page 1 of 10");
    await book.next.click();
    await book.expectPage("Page 2 of 10");
    await expect(book.root.getByRole("img", { name: "Demo page 2" })).toBeVisible();
    await expect(book.root.getByRole("img", { name: "Demo page 3" })).toHaveCount(0);
  });

  test("has no horizontal scrolling at any width", async ({ page }) => {
    for (const width of [320, 480, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `page overflows the window at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("right to left", () => {
  test("the arrow keys follow reading order", async ({ book, page }) => {
    await page.goto("/rtl");
    await book.expectPage("Page 1 of 10");
    await book.focus();
    await page.keyboard.press("ArrowLeft");
    await book.expectPage("Pages 2–3 of 10");
    await page.keyboard.press("ArrowRight");
    await book.expectPage("Page 1 of 10");
  });

  test("a page is dragged from the left edge", async ({ book, page }) => {
    await page.goto("/rtl");
    const box = await book.box();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, y, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.75, y, { steps: 8 });
    await page.mouse.up();
    await book.expectPage("Pages 2–3 of 10");
  });
});
