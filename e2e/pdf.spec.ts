import { expect, test } from "./fixtures";

// /search: a ten page PDF (guide.pdf) with real text, a table of contents and links, shown with a
// cover. Pages 2–3 are the contents; the back cover has a web link.
test.describe("a PDF", () => {
  test.beforeEach(async ({ page, book }) => {
    await page.goto("/search");
    await book.expectPage("Page 1 of 10");
    await expect(book.root.locator("canvas").first()).toBeVisible();
  });

  test("draws the pages PDF.js renders, and turns to the next ones", async ({ book }) => {
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    await expect(book.root.getByRole("img", { name: "Page 2" })).toBeVisible();
    await expect(book.root.getByRole("img", { name: "Page 3" })).toBeVisible();
    // Both pages end up with a picture, not an empty frame.
    await expect(book.root.locator('[role="img"][aria-busy="true"]')).toHaveCount(0);
    await expect(book.root.locator("canvas")).toHaveCount(2);
  });

  test.describe("search", () => {
    test("opens with the / key and finds every match across the document", async ({ book, page }) => {
      await book.focus();
      await page.keyboard.press("/");
      const box = book.root.getByRole("searchbox", { name: "Search the document" });
      await expect(box).toBeFocused();
      await box.fill("train");
      await expect(book.root.getByRole("status").filter({ hasText: /of 8$/ })).toHaveText("1 of 8");
      // Matches are listed with the page they are on, and marked.
      await expect(book.root.getByRole("button", { name: /^Page 6 / })).toHaveCount(3);
      await expect(book.root.locator("mark").first()).toBeVisible();
    });

    test("goes to the page of the result chosen", async ({ book, page }) => {
      await book.focus();
      await page.keyboard.press("/");
      await book.root.getByRole("searchbox").fill("train");
      await expect(book.root.getByRole("status").filter({ hasText: /of 8$/ })).toBeVisible();
      await book.root.getByRole("button", { name: /^Page 5 / }).click();
      await book.expectPage("Pages 4–5 of 10");
    });

    test("steps through results with Enter and Shift+Enter", async ({ book, page }) => {
      await book.focus();
      await page.keyboard.press("/");
      const box = book.root.getByRole("searchbox");
      await box.fill("train");
      const count = book.root.getByRole("status").filter({ hasText: / of 8$/ });
      await expect(count).toHaveText("1 of 8");
      await box.press("Enter");
      await expect(count).toHaveText("2 of 8");
      await box.press("Shift+Enter");
      await expect(count).toHaveText("1 of 8");
    });

    test("says so when there is nothing to find", async ({ book, page }) => {
      await book.focus();
      await page.keyboard.press("/");
      await book.root.getByRole("searchbox").fill("qwxzy");
      await expect(book.root.getByText("No results")).toBeVisible();
    });

    test("closes with Escape", async ({ book, page }) => {
      await book.focus();
      await page.keyboard.press("/");
      await expect(book.root.getByRole("tabpanel", { name: "Search" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(book.root.getByRole("tabpanel", { name: "Search" })).toHaveCount(0);
    });
  });

  test("the contents come from the PDF and go to a section", async ({ book }) => {
    await book.button("Contents").click();
    await expect(book.root.getByRole("navigation", { name: "Contents" })).toBeVisible();
    await book.root.getByRole("button", { name: "Getting around 5" }).click();
    await book.expectPage("Pages 4–5 of 10");
  });

  test("a link inside the PDF turns to its page", async ({ book }) => {
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    const link = book.root.getByRole("link", { name: "Go to page 7" });
    await expect(link).toBeVisible();
    await link.click();
    await book.expectPage("Pages 6–7 of 10");
  });

  test("a web link opens in a new tab and cannot reach back", async ({ book, page }) => {
    await book.focus();
    await page.keyboard.press("End");
    await book.expectPage("Page 10 of 10");
    const web = book.root.locator('a[data-flipbook-link][href^="http"]').first();
    await expect(web).toHaveAttribute("target", "_blank");
    await expect(web).toHaveAttribute("rel", /noopener/);
  });
});
