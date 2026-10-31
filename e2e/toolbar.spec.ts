import { expect, test } from "./fixtures";

// /features: a twelve page PDF with a cover, the toolbar, thumbnails, bookmarks (kept in this
// browser), download, print and share.
test.describe("toolbar", () => {
  test.beforeEach(async ({ page, book }) => {
    await page.goto("/features");
    await book.expectPage("Page 1 of 12");
    // The cover has been drawn by PDF.js.
    await expect(book.root.locator("canvas").first()).toBeVisible();
  });

  test("lists every control by name", async ({ book }) => {
    for (const name of ["Previous page", "Next page", "Zoom out", "Zoom in", "Fit to window", "Bookmark this page", "Bookmarks", "Thumbnails", "Enter fullscreen", "Download", "Print", "Share"]) {
      await expect(book.button(name)).toBeVisible();
    }
    await expect(book.root.getByRole("group", { name: "Zoom" })).toBeVisible();
  });

  test("zooms in and out, and goes back to the fitted size", async ({ book }) => {
    const fit = book.button("Fit to window");
    await expect(fit).toHaveText("100%");
    await expect(book.button("Zoom out")).toBeDisabled();

    // Zoom steps by a quarter, and the label follows the animation.
    await book.button("Zoom in").click();
    await expect(fit).toHaveText("125%");
    await expect(book.button("Zoom out")).toBeEnabled();

    await book.button("Zoom in").click();
    await expect(fit).toHaveText("150%");

    await book.button("Zoom out").click();
    await expect(fit).toHaveText("125%");

    await fit.click();
    await expect(fit).toHaveText("100%");
  });

  test("goes to a page from the thumbnails", async ({ book }) => {
    await book.button("Thumbnails").click();
    const list = book.root.getByRole("button", { name: /^Go to page \d+/ });
    await expect(list.first()).toBeVisible();
    await book.root.getByRole("button", { name: "Go to page 8" }).click();
    await book.expectPage("Pages 8–9 of 12");
    // The page being read is marked in the list.
    await expect(book.root.getByRole("button", { name: "Go to page 8", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("moves between thumbnails with the arrow keys", async ({ book, page }) => {
    await book.button("Thumbnails").click();
    const first = book.root.getByRole("button", { name: "Go to page 1", exact: true });
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(book.root.getByRole("button", { name: "Go to page 2", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(book.root.getByRole("button", { name: "Go to page 12", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await book.expectPage("Page 12 of 12");
  });

  test("bookmarks a page, lists it, and remembers it after a reload", async ({ book, page }) => {
    await book.button("Bookmark this page").click();
    await expect(book.button("Remove bookmark")).toBeVisible();

    await book.button("Bookmarks").click();
    await expect(book.root.getByRole("button", { name: /Go to page 1\b/ }).first()).toBeVisible();

    await page.reload();
    await book.expectPage("Page 1 of 12");
    await expect(book.button("Remove bookmark")).toBeVisible();

    await book.button("Remove bookmark").click();
    await expect(book.button("Bookmark this page")).toBeVisible();
  });

  test("bookmarks with the B key", async ({ book, page }) => {
    await book.focus();
    await page.keyboard.press("b");
    await expect(book.button("Remove bookmark")).toBeVisible();
    await page.keyboard.press("b");
    await expect(book.button("Bookmark this page")).toBeVisible();
  });

  test("downloads the PDF under the name it was given", async ({ book, page }) => {
    const download = page.waitForEvent("download");
    await book.button("Download").click();
    expect((await download).suggestedFilename()).toBe("sample.pdf");
  });

  test("copies a link when the browser cannot share", async ({ book, page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    });
    await book.button("Share").click();
    await expect(page.getByText("Link copied to the clipboard.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/features");
  });

  test("goes fullscreen and comes back", async ({ book, page }) => {
    await book.button("Enter fullscreen").click();
    await expect(book.button("Exit fullscreen")).toBeVisible();
    await book.button("Exit fullscreen").click();
    await expect(book.button("Enter fullscreen")).toBeVisible();
    await book.expectPage("Page 1 of 12");
    await page.keyboard.press("Escape");
  });
});
