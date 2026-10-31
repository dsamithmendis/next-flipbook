import { expect, test } from "./fixtures";

// The default build of PDF.js needs a browser from about February 2026. The "older browsers" demo
// uses its legacy build, which does not. This is the one place the test browser's age is the point,
// so the shim is off: it has to work in the browser as it is.
test.use({ shim: false });

test("the legacy PDF.js build works without any polyfill", async ({ book, page }) => {
  await page.goto("/pdf-legacy");
  await book.expectPage("Page 1 of 10");
  await expect(book.root.locator("canvas").first()).toBeVisible();

  await book.next.click();
  await book.expectPage("Pages 2–3 of 10");
  await expect(book.root.locator("canvas")).toHaveCount(2);

  // Text extraction and the outline go through the worker too.
  await book.root.focus();
  await page.keyboard.press("/");
  await book.root.getByRole("searchbox").fill("market");
  await expect(book.root.getByRole("status").filter({ hasText: / of \d+$/ })).toBeVisible();
  await book.button("Contents").click();
  await expect(book.root.getByRole("navigation", { name: "Contents" })).toBeVisible();
});
