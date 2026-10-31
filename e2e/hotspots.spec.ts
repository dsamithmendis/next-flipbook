import { expect, test } from "./fixtures";

// /hotspots: ten image pages with a cover. A hotspot on page 3 opens a popover, one on page 5 is a
// link, and a button drawn over the cover is the app's own React.
test.describe("hotspots and overlays", () => {
  test.beforeEach(async ({ page, book }) => {
    await page.goto("/hotspots");
    await book.expectPage("Page 1 of 10");
  });

  test("an overlay is the app's own element on a page, and it works", async ({ book, page }) => {
    const overlay = book.root.getByRole("button").filter({ hasNotText: /page|zoom|fit|fullscreen|bookmark|thumbnails/i });
    await expect(overlay.first()).toBeVisible();
    await overlay.first().click();
    await expect(page.getByText(/Pressed|Followed|clicked/i).first()).toBeVisible();
  });

  test("a hotspot opens a popover that closes with Escape", async ({ book, page }) => {
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    const hotspot = book.root.getByRole("button", { name: "About the morning light" });
    await hotspot.click();
    const popover = book.root.getByText("Shot at 6:10");
    await expect(popover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    // Escape closed the popover, not the book or the page.
    await book.expectPage("Pages 2–3 of 10");
  });

  test("a hotspot with an address is a real link", async ({ book }) => {
    await book.focus();
    await book.next.click();
    await book.next.click();
    await book.expectPage("Pages 4–5 of 10");
    const link = book.root.getByRole("link", { name: "Read more about slow trains" });
    await expect(link).toHaveAttribute("href", "https://example.com/slow-trains");
  });
});
