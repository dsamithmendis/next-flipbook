import { expect, test } from "./fixtures";

// Runs in the "mobile" project: a Pixel 7 with touch, in portrait.
test.describe("on a phone", () => {
  test("shows one page and fits the screen", async ({ book, page }) => {
    await page.goto("/images");
    await book.expectPage("Page 1 of 10");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await book.next.click();
    await book.expectPage("Page 2 of 10");
    await expect(book.root.getByRole("img", { name: "Demo page 3" })).toHaveCount(0);
  });

  test("keeps the toolbar inside the screen and every control large enough to touch", async ({ book, page }) => {
    await page.goto("/features");
    await book.expectPage("Page 1 of 12");
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const buttons = book.root.getByRole("group", { name: "Flipbook toolbar" }).getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(5);
    for (let index = 0; index < count; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      if (!box) continue; // a control that has collapsed into a menu has no box
      const name = (await buttons.nth(index).getAttribute("aria-label")) ?? (await buttons.nth(index).innerText());
      expect(box.x, `${name} starts inside the screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name} ends inside the screen`).toBeLessThanOrEqual(viewport!.width + 1);
      expect(Math.min(box.width, box.height), `${name} is at least 32px, a touch target`).toBeGreaterThanOrEqual(32);
    }
  });

  test("opens the thumbnails with a tap and goes to a page from them", async ({ book, page }) => {
    await page.goto("/features");
    await book.expectPage("Page 1 of 12");
    await book.button("Thumbnails").tap();
    await book.root.getByRole("button", { name: "Go to page 6", exact: true }).tap();
    await book.expectPage("Page 6 of 12");
  });

  test("turns by swiping a page", async ({ book, page }) => {
    await page.goto("/images");
    await book.expectPage("Page 1 of 10");
    const box = await book.box();
    const y = box.y + box.height / 2;
    // The page is dragged with a finger: pointer events of type touch.
    const client = await page.context().newCDPSession(page);
    const touch = async (type: "touchStart" | "touchMove" | "touchEnd", x: number): Promise<void> => {
      await client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    };
    const from = box.x + box.width - 30;
    await touch("touchStart", from);
    for (let step = 1; step <= 12; step += 1) await touch("touchMove", from - step * (box.width * 0.07));
    await touch("touchEnd", from);
    await book.expectPage("Page 2 of 10");
  });
});
