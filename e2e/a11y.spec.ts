import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test, type Book } from "./fixtures";

// axe-core checks of the viewer in the states a reader can reach, in light and dark. Only the
// viewer is scanned: the demo's own page around it is not the library's to get right. A finding
// is listed with the element it is about, so a failure says what to fix.
async function scan(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).include('[role="region"][aria-label="Flipbook"]').analyze();
  return result.violations.map((violation) => {
    const where = violation.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(" | ");
    return `${violation.id} (${violation.impact}): ${violation.help} — ${where}`;
  });
}

const scenarios: Array<{ name: string; path: string; ready: RegExp; setup?: (book: Book, page: Page) => Promise<void> }> = [
  { name: "images, the cover", path: "/images", ready: /Page 1 of 10/ },
  {
    name: "images, a spread",
    path: "/images",
    ready: /Page 1 of 10/,
    setup: async (book) => {
      await book.next.click();
      await book.expectPage("Pages 2–3 of 10");
    },
  },
  { name: "right to left", path: "/rtl", ready: /Page 1 of 10/ },
  {
    name: "a PDF with the thumbnails open",
    path: "/features",
    ready: /Page 1 of 12/,
    setup: async (book) => {
      await book.button("Bookmark this page").click();
      await book.button("Thumbnails").click();
      await expect(book.root.getByRole("button", { name: /^Go to page 3/ })).toBeVisible();
    },
  },
  {
    name: "a PDF with the bookmarks open",
    path: "/features",
    ready: /Page 1 of 12/,
    setup: async (book) => {
      await book.button("Bookmark this page").click();
      await book.button("Bookmarks").click();
      await expect(book.root.getByRole("tabpanel", { name: "Bookmarks" })).toBeVisible();
    },
  },
  {
    name: "search with results",
    path: "/search",
    ready: /Page 1 of 10/,
    setup: async (book, page) => {
      await book.focus();
      await page.keyboard.press("/");
      await book.root.getByRole("searchbox").fill("train");
      await expect(book.root.getByRole("status").filter({ hasText: / of 8$/ })).toBeVisible();
    },
  },
  {
    name: "the table of contents",
    path: "/search",
    ready: /Page 1 of 10/,
    setup: async (book) => {
      await book.button("Contents").click();
      await expect(book.root.getByRole("navigation", { name: "Contents" })).toBeVisible();
    },
  },
  {
    name: "a hotspot popover",
    path: "/hotspots",
    ready: /Page 1 of 10/,
    setup: async (book) => {
      await book.next.click();
      await book.expectPage("Pages 2–3 of 10");
      await book.root.getByRole("button", { name: "About the morning light" }).click();
      await expect(book.root.getByText("Shot at 6:10")).toBeVisible();
    },
  },
];

// The viewer's theme is the `theme` prop, not the operating system's colour scheme, so the default
// is light whatever `prefers-color-scheme` says. These run the demo pages as they are.
test.describe("the default (light) theme", () => {
  for (const scenario of scenarios) {
    test(`${scenario.name} has no accessibility violations`, async ({ book, page }) => {
      await page.goto(scenario.path);
      await expect(book.status).toHaveText(scenario.ready);
      await scenario.setup?.(book, page);
      // Let any turn or panel animation finish, so axe reads the settled colours.
      await page.waitForTimeout(900);
      expect(await scan(page)).toEqual([]);
    });
  }
});

// The dark theme, on the playground, which can switch it on for any content. Each scenario first
// proves the viewer really is dark, because a scan of a light viewer would pass for the wrong reason.
const darkScenarios: Array<{ name: string; setup: (book: Book, page: Page) => Promise<void> }> = [
  { name: "images, the cover", setup: async () => undefined },
  {
    name: "images, a spread",
    setup: async (book, page) => {
      // The playground's viewer is narrow, so ask for two pages explicitly.
      await page.getByLabel("mode").selectOption("double");
      await book.next.click();
      await book.expectPage("Pages 2–3 of 10");
    },
  },
  {
    name: "right to left",
    setup: async (_book, page) => {
      await page.getByLabel("direction").selectOption("rtl");
    },
  },
  {
    name: "a PDF with the thumbnails open",
    setup: async (book, page) => {
      await page.getByLabel("Show").selectOption("pdf");
      await book.expectPage("Page 1 of 10");
      await book.button("Bookmark this page").click();
      await book.button("Thumbnails").click();
      await expect(book.root.getByRole("button", { name: /^Go to page 3/ })).toBeVisible();
    },
  },
  {
    name: "a PDF with the bookmarks open",
    setup: async (book, page) => {
      await page.getByLabel("Show").selectOption("pdf");
      await book.expectPage("Page 1 of 10");
      await book.button("Bookmark this page").click();
      await book.button("Bookmarks").click();
      await expect(book.root.getByRole("tabpanel", { name: "Bookmarks" })).toBeVisible();
    },
  },
  {
    name: "search with results",
    setup: async (book, page) => {
      await page.getByLabel("Show").selectOption("pdf");
      await book.expectPage("Page 1 of 10");
      await page.getByRole("checkbox", { name: "search" }).check();
      await book.focus();
      await page.keyboard.press("/");
      await book.root.getByRole("searchbox").fill("train");
      await expect(book.root.getByRole("status").filter({ hasText: / of 8$/ })).toBeVisible();
    },
  },
  {
    name: "the table of contents",
    setup: async (book, page) => {
      await page.getByLabel("Show").selectOption("pdf");
      await book.expectPage("Page 1 of 10");
      await page.getByRole("checkbox", { name: "outline" }).check();
      await book.button("Contents").click();
      await expect(book.root.getByRole("navigation", { name: "Contents" })).toBeVisible();
    },
  },
];

test.describe("the dark theme", () => {
  for (const scenario of darkScenarios) {
    test(`${scenario.name} has no accessibility violations`, async ({ book, page }) => {
      await page.goto("/playground");
      await book.expectPage("Page 1 of 10");
      await page.getByLabel("theme").selectOption("dark");
      await expect(book.root).toHaveAttribute("data-flipbook-theme", "dark");
      await scenario.setup(book, page);
      await expect(book.root).toHaveAttribute("data-flipbook-theme", "dark");
      await page.waitForTimeout(900);
      expect(await scan(page)).toEqual([]);
    });
  }
});

test("the password dialog has no accessibility violations", async ({ page }) => {
  await page.goto("/pdf-password");
  await expect(page.getByRole("dialog", { name: "Password required" })).toBeVisible();
  const result = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});

test("every control can be reached and used without a pointer", async ({ book, page }) => {
  await page.goto("/features");
  await book.expectPage("Page 1 of 12");
  // Tab from the viewer through the toolbar: each stop is a named, enabled control.
  await book.focus();
  const reached: string[] = [];
  for (let step = 0; step < 14; step += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const element = document.activeElement;
      return element ? (element.getAttribute("aria-label") ?? element.textContent ?? "").trim() : "";
    });
    if (name) reached.push(name);
  }
  for (const expected of ["Next page", "Zoom in", "Bookmark this page", "Thumbnails", "Enter fullscreen", "Download", "Print", "Share"]) {
    expect(reached, `Tab reaches "${expected}"`).toContain(expected);
  }
});
