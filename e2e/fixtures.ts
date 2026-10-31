import { expect, test as base, type Locator, type Page } from "@playwright/test";

// pdfjs-dist 6 uses Map.prototype.getOrInsertComputed, which Chromium before about 145 lacks, and
// Playwright 1.56 ships Chromium 141. So, unless a test says `test.use({ shim: false })`, a small
// shim is added to the page and to the PDF.js worker. It is a no-op in a browser that has the
// methods, it is for the test browser only, and the library does not contain it. The "older
// browsers" demo uses PDF.js's legacy build and is tested without the shim.
const SHIM = `(() => {
  for (const C of [Map, WeakMap]) {
    if (!C.prototype.getOrInsert) Object.defineProperty(C.prototype, "getOrInsert", { configurable: true, writable: true,
      value: function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); } });
    if (!C.prototype.getOrInsertComputed) Object.defineProperty(C.prototype, "getOrInsertComputed", { configurable: true, writable: true,
      value: function (k, f) { if (this.has(k)) return this.get(k); const v = f(k); this.set(k, v); return v; } });
  }
})();`;

/** What a test sees of the viewer on the page. */
export class Book {
  constructor(readonly page: Page) {}

  /** The viewer's root. The first one, on a page with more than one. */
  get root(): Locator {
    return this.page.getByRole("region", { name: "Flipbook" }).first();
  }
  get next(): Locator {
    return this.root.getByRole("button", { name: "Next page" });
  }
  get previous(): Locator {
    return this.root.getByRole("button", { name: "Previous page" });
  }
  /** The toolbar's "2–3 / 10". */
  get indicator(): Locator {
    return this.root.getByRole("group", { name: "Page navigation" });
  }
  /** The text a screen reader is given, "Pages 2–3 of 10". */
  get status(): Locator {
    return this.root.getByText(/^Pages? \d+(–\d+)? of \d+$/);
  }
  button(name: string | RegExp): Locator {
    return this.root.getByRole("button", { name });
  }
  /** Moves keyboard focus to the viewer, so that the arrow keys reach it. */
  async focus(): Promise<void> {
    await this.root.focus();
  }
  async box(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.root.boundingBox();
    if (!box) throw new Error("The viewer is not on the page.");
    return box;
  }
  /** Waits for the viewer to say which page it shows. */
  async expectPage(text: string): Promise<void> {
    await expect(this.status).toHaveText(text);
  }
}

interface Options {
  /** Adds the shim described above. */
  shim: boolean;
}
interface Fixtures {
  /** Console errors and uncaught exceptions. A test fails if any are left at its end. */
  problems: string[];
  book: Book;
}

export const test = base.extend<Options & Fixtures>({
  shim: [true, { option: true }],

  context: async ({ context, shim }, use) => {
    if (shim) {
      await context.addInitScript({ content: SHIM });
      // The default worker and the one a bundler emits (`pdf.worker.min.<hash>.mjs`). The legacy
      // worker matches too, which is harmless.
      await context.route(/pdf\.worker[^/]*\.mjs(\?.*)?$/, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${SHIM}\n${await response.text()}`, contentType: "text/javascript" });
      });
    }
    await use(context);
  },

  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
      await use(problems);
      expect(problems, "console errors and uncaught exceptions").toEqual([]);
    },
    { auto: true },
  ],

  book: async ({ page }, use) => {
    await use(new Book(page));
  },
});

export { expect };
