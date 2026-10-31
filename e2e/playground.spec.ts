import { expect, test } from "./fixtures";

// /playground: controls for the props, the code that gives the viewer as it is, and a log of events.
test.describe("the playground", () => {
  test.beforeEach(async ({ page, book }) => {
    await page.goto("/playground");
    await book.expectPage("Page 1 of 10");
  });

  test("writes the code for only the props that differ from the defaults", async ({ page }) => {
    const code = page.getByTestId("playground-code");
    await expect(code).toContainText("pages={pages}");
    await expect(code).toContainText("cover");
    await expect(code).toContainText("thumbnails");
    await expect(code).not.toContainText("mode=");

    await page.getByLabel("mode").selectOption("single");
    await page.getByLabel("direction").selectOption("rtl");
    await page.getByRole("checkbox", { name: "cover" }).uncheck();
    await expect(code).toContainText('mode="single"');
    await expect(code).toContainText('direction="rtl"');
    await expect(code).not.toContainText("cover");
  });

  test("applies a change to the viewer at once", async ({ book, page }) => {
    await expect(book.button("Thumbnails")).toBeVisible();
    await page.getByRole("checkbox", { name: "thumbnails" }).uncheck();
    await expect(book.button("Thumbnails")).toHaveCount(0);

    await page.getByRole("checkbox", { name: "toolbar" }).uncheck();
    await expect(book.root.getByRole("group", { name: "Flipbook toolbar" })).toHaveCount(0);
  });

  test("shows the PDF, and only then lets search and contents be switched on", async ({ book, page }) => {
    const search = page.getByRole("checkbox", { name: "search" });
    await expect(search).toBeDisabled();

    await page.getByLabel("Show").selectOption("pdf");
    await book.expectPage("Page 1 of 10");
    await expect(book.root.locator("canvas").first()).toBeVisible();
    await expect(search).toBeEnabled();
    await search.check();
    await expect(book.button("Search")).toBeVisible();
    await expect(page.getByTestId("playground-code")).toContainText('source="/guide.pdf"');
  });

  test("logs what the viewer reports", async ({ book, page }) => {
    // The viewer is narrow here, so ask for two pages explicitly.
    await page.getByLabel("mode").selectOption("double");
    await book.next.click();
    await book.expectPage("Pages 2–3 of 10");
    const events = page.getByTestId("playground-events");
    await expect(events).toContainText("turn 1 to 2");
    await expect(events).toContainText("page 2");
  });

  test("goes back to the defaults", async ({ book, page }) => {
    await page.getByLabel("mode").selectOption("single");
    await page.getByRole("checkbox", { name: "thumbnails" }).uncheck();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByLabel("mode")).toHaveValue("auto");
    await expect(book.button("Thumbnails")).toBeVisible();
  });
});
