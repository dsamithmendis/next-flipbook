import type { Page } from "@playwright/test";
import { expect, test, type Book } from "./fixtures";

// /deep-links: guide.pdf with `urlState` (the page is in the address) and `persistState` (the place
// is remembered between visits, and the address wins over it).
const pageInAddress = (url: string): string | null => new URL(url).searchParams.get("page");

test.describe("deep links and the saved place", () => {
  test("opens at the page in the address", async ({ book, page }) => {
    await page.goto("/deep-links?page=5");
    await book.expectPage("Pages 4–5 of 10");
  });

  test("keeps the address in step with the page", async ({ book, page }) => {
    await page.goto("/deep-links");
    await book.expectPage("Page 1 of 10");
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    await expect.poll(() => pageInAddress(page.url())).toBe("2");
    await book.next.click();
    await expect.poll(() => pageInAddress(page.url())).toBe("4");
  });

  test("follows the address when it changes under the book", async ({ book, page }) => {
    await page.goto("/deep-links?page=3");
    await book.expectPage("Pages 2–3 of 10");
    await page.evaluate(() => {
      window.history.pushState(null, "", "/deep-links?page=9");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await book.expectPage("Pages 8–9 of 10");
  });

  // The place is saved when the reader turns a page, a moment after they stop. Landing on a page
  // from an address is not turning, so these turn by hand.
  // Turns the cover and then spreads 2–3, 4–5 ... one at a time, letting each turn finish.
  async function turnSpreads(book: Book, page: Page, count: number): Promise<void> {
    for (let spread = 1; spread <= count; spread += 1) {
      await book.next.click();
      await book.expectPage(`Pages ${spread * 2}–${spread * 2 + 1} of 10`);
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(700);
  }

  test("opens where the reader left off when the address has no page", async ({ book, page }) => {
    await page.goto("/deep-links");
    await book.expectPage("Page 1 of 10");
    await turnSpreads(book, page, 3);

    await page.goto("/deep-links");
    await book.expectPage("Pages 6–7 of 10");
  });

  test("the address wins over the saved place", async ({ book, page }) => {
    await page.goto("/deep-links");
    await turnSpreads(book, page, 3);

    await page.goto("/deep-links?page=3");
    await book.expectPage("Pages 2–3 of 10");
  });

  test("the links on the page open the book at the page they name", async ({ book, page }) => {
    await page.goto("/deep-links");
    await book.expectPage("Page 1 of 10");
    await page.getByRole("link", { name: "Open at page 9" }).click();
    await book.expectPage("Pages 8–9 of 10");
  });
});
