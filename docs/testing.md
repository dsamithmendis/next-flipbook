# Testing

What is tested, how to run it, and what none of it proves. There are four layers, and each catches things the others cannot.

| Layer | Command | What it is | Size |
| --- | --- | --- | --- |
| Lint and types | `npm run lint`, `npm run typecheck:all` | ESLint with type information, `tsc` over the library, the demo and the e2e tests | the whole repository |
| Unit and component | `npm test` | Vitest, with jsdom for components and the real `pdfjs-dist` for PDF code | 571 tests in 34 files |
| End to end | `npm run e2e` | Playwright against the built demo, in Chromium (and a phone) | 71 tests |
| Visual | `npm run e2e:visual` | Screenshots of the viewer compared with committed ones | 10 screenshots |

Beside them, [`benchmarks/`](../benchmarks/README.md) measures speed and memory. Those are not tests: they have no pass mark, so they are not in CI. [`docs/performance.md`](performance.md) has their results.

## Lint and types

```bash
npm run lint           # eslint . --max-warnings 0
npm run lint:fix
npm run typecheck:all  # the library, the demo and e2e/
```

One flat config, `eslint.config.mjs`, covers the whole repository: `typescript-eslint` with type information (so a floating promise is an error), and the `react-hooks` rules, version 7, for every component and hook. Warnings fail the build. There are no inline `eslint-disable` comments to hunt for: a finding is fixed, or the rule is turned off in the config with a reason beside it. If you want to turn one off, put the reason there too.

## Unit and component tests

```bash
npm test               # everything, once
npm run test:watch -w next-flipbook
```

They sit in `packages/flipbook/tests`, in three kinds:

- **Pure logic** (`*.test.ts`): the engine with a fake scheduler, layout, drag and gesture maths, zoom, the cache, search, bookmarks, persistence. No DOM.
- **Components** (`*.dom.test.tsx`): the real `<FlipBook>` in jsdom, driven through the DOM the way a user would, with `@testing-library/react`. jsdom has no layout, so `tests/helpers/domSetup.ts` stubs sizes and the observers.
- **PDF**: `pdf.session.test.ts` and the component tests use `tests/helpers/fakePdfjs.ts`, a controllable stand-in for `pdfjs-dist` (renders finish when the test says so, which is how races are tested). `pdf.real.test.ts` runs the real `pdfjs-dist` on generated PDFs, with `@napi-rs/canvas` to draw.

Two groups are worth knowing about:

- **Leaks** (`flipbook.cleanup.dom.test.tsx`): mounts and unmounts a PDF book, including under `StrictMode`, and checks that no document, loading task, render, listener, observer, timer or canvas pixels are left. It tracks them itself, and a test checks the trackers.
- **Memory limits** (`performance.test.ts`, `flipbook.performance.dom.test.tsx`, `flipbook.thumbnails.*.test.tsx`): that prefetch fits the cache, that a jump cancels work, that idle cleanup never runs during a render, that thumbnails redraw only what changed.

A test that passes proves little until you have seen it fail. When you fix a bug, make the test fail on the old code first.

## End-to-end tests

```bash
npm run build:demo
npm run e2e                       # starts the demo on port 3100, or uses the one running there
npm run e2e -- e2e/book.spec.ts   # one file
npx playwright show-report        # after a CI-style run
```

They drive the production build of the demo in a real browser, so they cover what jsdom cannot: layout, real pointer and touch input, canvases, the PDF.js worker, focus, and Next.js itself. `e2e/playwright.config.ts` has the settings; `e2e/fixtures.ts` has the `Book` helper (`book.next`, `book.expectPage("Pages 2–3 of 10")`) that the specs use.

| Spec | Covers |
| --- | --- |
| `book.spec.ts` | Turning with buttons, keys and drags; the cover and the last page; resizing; right to left |
| `toolbar.spec.ts` | Zoom, thumbnails, bookmarks, fullscreen, the actions menu |
| `pdf.spec.ts` | Drawing PDF pages, search, contents, links, the back cover |
| `password.spec.ts` | A password-protected PDF: asking, a wrong password, a right one |
| `hotspots.spec.ts`, `deep-links.spec.ts` | Hotspots and popovers; the address, back and forward, a saved place |
| `long-pdf.spec.ts` | A 1000 page PDF: bounded canvases and caches, cleanup on leaving |
| `playground.spec.ts` | The `/playground` page: its code, its controls, its event log |
| `legacy.spec.ts` | The legacy PDF.js build, with no polyfill |
| `mobile.spec.ts` | A Pixel 7 in portrait: one page, swipes, touch-sized controls |
| `a11y.spec.ts` | axe-core scans, and the keyboard |

A test fails if the page logs a console error or throws, whatever it was checking (`fixtures.ts`).

**Accessibility.** `a11y.spec.ts` runs axe-core over the viewer, and only the viewer, in the states a reader can reach: cover, spread, right to left, thumbnails, bookmarks, search results, contents and a hotspot popover, in the default theme and in the dark one. The theme is the `theme` prop and does not follow the operating system's colour scheme, so the dark scans go through the playground, which can switch it on for any content, and each checks that the viewer really is dark before it scans. Another test tabs through the toolbar. axe finds the mistakes a machine can find, roughly a third of the WCAG failures. It does not tell you whether the page makes sense to a screen-reader user, and no screen reader was used.

**Other browsers.** Chromium and a Chromium-based phone run by default. Firefox and WebKit are opt-in, for `book` and `toolbar` only:

```bash
npx playwright install firefox webkit
E2E_ALL_BROWSERS=1 npm run e2e
```

They have not been run as part of this work, and are not in CI.

**An old Chromium.** `pdfjs-dist` 6 uses `Map.prototype.getOrInsertComputed`, which Chromium before about 145 lacks, and Playwright 1.56 ships Chromium 141. So `fixtures.ts` adds a small shim to the page and to the PDF.js worker unless a test says `test.use({ shim: false })`. It is for the test browser only; the library does not contain it, and a current browser does not need it. The "older browsers" demo uses PDF.js's legacy build and is tested without the shim. `CHROMIUM_PATH=/path/to/chrome` uses a browser you already have.

## Visual tests

```bash
npm run e2e:visual           # compare
npm run e2e:visual:update    # make new screenshots, then look at them
```

`e2e/visual.spec.ts` photographs the viewer (never the demo page around it) in ten states: the cover, a spread, the last page, a single page, right to left, a PDF with the thumbnails open, search results, a hotspot popover, and the dark theme with images and with a PDF. The pages are SVG images and a generated PDF, so nothing in them changes between runs. A screenshot passes if less than 1% of its pixels differ (3% for the ones that show PDF text, which the browser draws with the fonts it has).

They catch what the other tests cannot: a page turn that is correct but ugly, a toolbar that overlaps its neighbour, a colour that is wrong in dark mode. `npm run e2e` leaves them out, for a reason: **a screenshot depends on the machine's fonts and the browser's build**, so one made on a laptop will not match one made on a CI runner.

- The committed screenshots (`e2e/visual.spec.ts-snapshots/*-linux.png`) were made in the development sandbox, on Linux with Playwright 1.56's Chromium 141. They passed repeatedly there, and a wrong screenshot made them fail.
- CI runs them in Playwright's own container image (`mcr.microsoft.com/playwright`), as an **advisory** job: a failure does not block a merge. Those screenshots were not made in that image, so the first run may differ in font rendering.
- To fix that, run the **Visual baselines** workflow from the Actions tab. It makes the screenshots in the same image CI uses and uploads them. Look at them, commit them to `e2e/visual.spec.ts-snapshots`, and remove `continue-on-error` from the `visual` job in `.github/workflows/ci.yml`. Until then the visual job tells you something has changed, not that something is wrong.
- Other platforms get their own files (`-darwin`, `-win32`) the first time they run `npm run e2e:visual:update`.

## The playground

`/playground` in the demo is the library's Storybook: controls for the props, the JSX that gives the viewer as it is (only the props that differ from the defaults), and a log of what the viewer reports. Use it to try a combination by hand, and to reproduce a report. `npm run dev` starts it. Storybook itself was not added: it would be a second toolchain to keep in step with the library for what one page does, and the page doubles as the thing the end-to-end tests drive.

## The published package

```bash
npm run verify:pack
```

Every test above runs against the source tree, so none would notice a file missing from the package, an export that points at nothing, a type that does not resolve, or an import that reads `window`. `verify:pack` packs the library, installs the tarball into an empty project beside React and TypeScript, and then:

1. checks the tarball holds every file `exports` names, and nothing that is not part of the package (no `src/`, no tests);
2. imports every entry point in plain Node, where there is no DOM;
3. renders a book to a string on the server;
4. type-checks a consumer file under both `Bundler` and `NodeNext` module resolution.

It needs the npm registry. CI and the release workflow both run it.

## What none of this proves

- **Real devices.** Touch was exercised with Playwright's emulation, not a finger on a phone. Safari and iOS were not run at all, and their canvas memory limits are the likeliest place for a long PDF to fail.
- **Printing.** The print dialog was replaced in tests. A job that renders pages and hands them to the browser was tested; what the browser then does was not.
- **Screen readers.** Roles, names and focus order are checked by machine. Nobody has listened to it with VoiceOver, NVDA or TalkBack.
- **Statistical claims.** The benchmarks are single runs on a shared machine.
- **Scale beyond the tests.** The largest document used was 1000 pages of generated text. Scans and heavy artwork cost more per page.
