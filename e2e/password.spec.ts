import { expect, test } from "./fixtures";

// /pdf-password: the document asks for a password, which is "secret".
test.describe("a password-protected PDF", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pdf-password");
  });

  test("asks for the password in a dialog, and opens when it is right", async ({ book, page }) => {
    const dialog = page.getByRole("dialog", { name: "Password required" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Password")).toBeFocused();

    await dialog.getByLabel("Password").fill("secret");
    await dialog.getByRole("button", { name: "Open" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(book.status).toBeVisible();
    await expect(book.root.locator("canvas").first()).toBeVisible();
  });

  test("says when the password is wrong and lets the reader try again", async ({ book, page }) => {
    const dialog = page.getByRole("dialog", { name: "Password required" });
    await dialog.getByLabel("Password").fill("not-it");
    await dialog.getByRole("button", { name: "Open" }).click();
    await expect(dialog.getByText("That password is not correct. Try again.")).toBeVisible();

    await dialog.getByLabel("Password").fill("secret");
    await dialog.getByRole("button", { name: "Open" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(book.root.locator("canvas").first()).toBeVisible();
  });

  test("submits with Enter", async ({ book, page }) => {
    const dialog = page.getByRole("dialog", { name: "Password required" });
    await dialog.getByLabel("Password").fill("secret");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(book.root.locator("canvas").first()).toBeVisible();
  });
});
