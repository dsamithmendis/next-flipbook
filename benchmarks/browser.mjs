// Real-browser benchmark. Drives the "Very long PDF" demo in Chromium and measures what the
// Node benchmark cannot: how a page turn feels while pages render, how many nodes and canvases
// stay alive, how much memory the browser holds, and whether leaving the page cleans up.
//
//   npm run build:demo
//   npm run start -w next-flipbook-demo -- -p 3100        # in another terminal
//   node benchmarks/browser.mjs [--url=http://localhost:3100] [--pages=100,500,1000]
//        [--turns=40] [--dwell=120] [--jumps=12] [--cycles=8] [--dpr=1] [--width=1280] [--height=900]
//        [--query=qwxz] [--params=cleanup=0] [--cleanup=false] [--json=out.json]
//        [--chromium=/path/to/chrome] [--playwright=/path/with/node_modules/] [--polyfill=auto|on|off]
//
// Playwright is not a dependency of this repository yet. Install it where Node can find it
// (npm i -D playwright, or point --playwright at a directory that has it), plus a Chromium.
//
// What the numbers mean, and what they do not:
//  * Frame timing is the interval between requestAnimationFrame callbacks while a page turn runs.
//    Headless Chromium paints in software, so absolute frame rates are far below what a phone or
//    a laptop GPU gives. Compare sizes and builds against each other, not against 60 fps.
//  * "Heap" is the page's JavaScript heap after a forced garbage collection. It excludes the
//    PDF.js worker and canvas bitmaps. "Browser RSS" is every Chromium process added together
//    (Linux only), so it includes those, and about 200 MB of the browser itself: read the change.
//  * The pages are rendered from a generated PDF served from localhost, so there is no network
//    cost. A real download adds to time to first page.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const config = {
  url: (args.url ?? "http://localhost:3100").replace(/\/$/, ""),
  pages: (args.pages ?? "100,500,1000").split(",").map(Number),
  turns: Number(args.turns ?? 40),
  dwell: Number(args.dwell ?? 120),
  jumps: Number(args.jumps ?? 12),
  cycles: Number(args.cycles ?? 8),
  dpr: Number(args.dpr ?? 1),
  width: Number(args.width ?? 1280),
  height: Number(args.height ?? 900),
  query: args.query ?? "qwxz",
  // Extra query string for the demo page, for example "cleanup=0".
  params: args.params ? `&${args.params}` : "",
  cleanup: args.cleanup !== "false",
  polyfill: args.polyfill ?? "auto",
  chromium: args.chromium ?? process.env.CHROMIUM_PATH,
};

function loadPlaywright() {
  const places = [import.meta.url, args.playwright ?? process.env.PLAYWRIGHT_DIR].filter(Boolean);
  for (const place of places) {
    try {
      return createRequire(place)("playwright");
    } catch {
      // try the next place
    }
  }
  console.error("Could not load Playwright. Install it (npm i -D playwright) or pass --playwright=<dir with node_modules>.");
  process.exit(2);
}
const { chromium } = loadPlaywright();

// ---- test-only shim ------------------------------------------------------------------------
// pdfjs-dist 6 uses Map.prototype.getOrInsertComputed, which Chromium before about 145 lacks.
// This is applied only to the benchmark's browser, in the page and in the PDF.js worker. It is
// not part of the library; current browsers do not need it, and with --polyfill=auto it is only
// used when the browser is missing the method.
const SHIM = `(() => {
  for (const C of [Map, WeakMap]) {
    if (!C.prototype.getOrInsert) Object.defineProperty(C.prototype, "getOrInsert", { configurable: true, writable: true,
      value: function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); } });
    if (!C.prototype.getOrInsertComputed) Object.defineProperty(C.prototype, "getOrInsertComputed", { configurable: true, writable: true,
      value: function (k, f) { if (this.has(k)) return this.get(k); const v = f(k); this.set(k, v); return v; } });
  }
})();`;

// Injected before every page script. Everything the runs below read lives on window.__bench.
const INSTRUMENT = `(() => {
  const bench = { intervals: [], longTasks: [], peakCanvases: 0, sampling: false, last: null };
  window.__bench = bench;
  const frame = (t) => {
    if (bench.sampling) {
      if (bench.last !== null) bench.intervals.push(t - bench.last);
      bench.last = t;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) bench.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  setInterval(() => {
    const n = document.querySelectorAll("canvas").length;
    if (n > bench.peakCanvases) bench.peakCanvases = n;
  }, 20);
  bench.begin = () => { bench.sampling = true; bench.last = null; return performance.now(); };
  bench.end = () => { bench.sampling = false; return performance.now(); };
  bench.reset = () => { bench.intervals = []; bench.longTasks = []; bench.peakCanvases = 0; };
  bench.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Polls once per frame. Resolves with the elapsed ms, or null on timeout.
  bench.until = async (test, timeout = 5000) => {
    const t0 = performance.now();
    for (;;) {
      if (test()) return performance.now() - t0;
      if (performance.now() - t0 > timeout) return null;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  };
  // Every page that is mounted has been drawn.
  bench.allDrawn = () =>
    document.querySelectorAll('[role="img"][aria-busy]').length > 0 &&
    document.querySelectorAll('[role="img"][aria-busy="true"]').length === 0;
  bench.pageDrawn = (n) => {
    const el = document.querySelector('[role="img"][aria-label="Page ' + n + '"]');
    return !!el && el.getAttribute("aria-busy") === "false" && !!el.querySelector("canvas");
  };
})();`;

// ---- helpers -------------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits = 1) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));
const mb = (bytes) => round(bytes / 1048576);
function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const overlapping = (tasks, windows) =>
  tasks.filter((task) => windows.some(([from, to]) => task.start < to && task.start + task.duration > from));

function frameStats(intervals, longTasks, windows) {
  const tasks = overlapping(longTasks, windows);
  const mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  return {
    frames: intervals.length,
    fps: mean ? round(1000 / mean) : null,
    p50: round(quantile(intervals, 0.5)),
    p95: round(quantile(intervals, 0.95)),
    p99: round(quantile(intervals, 0.99)),
    max: round(Math.max(0, ...intervals)),
    over25: intervals.filter((v) => v > 25).length,
    over50: intervals.filter((v) => v > 50).length,
    longTasks: tasks.length,
    longTaskMs: round(tasks.reduce((sum, t) => sum + t.duration, 0)),
  };
}

/** Sum of resident memory over every Chromium process, in MB. Linux only; null elsewhere. */
async function browserRss(browserCdp) {
  try {
    const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
    let kb = 0;
    for (const { id } of processInfo) {
      try {
        const status = readFileSync(`/proc/${id}/status`, "utf8");
        kb += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
      } catch {
        // the process ended
      }
    }
    return kb > 0 ? round(kb / 1024, 0) : null;
  } catch {
    return null;
  }
}

/** Forces garbage collection, then reads the page heap and the DOM counters. */
async function snapshot(cdp, browserCdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(120);
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  return {
    heapMB: mb(heap.usedSize),
    nodes: dom.nodes,
    listeners: dom.jsEventListeners,
    documents: dom.documents,
    rssMB: await browserRss(browserCdp),
  };
}

async function newContext(browser, needsShim) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.dpr,
  });
  await context.addInitScript({ content: INSTRUMENT });
  if (needsShim) {
    await context.addInitScript({ content: SHIM });
    await context.route("**/pdf.worker.min.mjs", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${SHIM}\n${await response.text()}`, contentType: "text/javascript" });
    });
  }
  return context;
}

/** Runs inside the page: turns the book `turns` times, looking at each spread for `dwell` ms. */
async function driveTurns({ turns, dwell }) {
  const b = window.__bench;
  const ctl = window.__flipbookBench.controller();
  b.reset();
  const windows = [];
  const blank = [];
  const worstFrame = [];
  for (let i = 0; i < turns; i += 1) {
    const seen = b.intervals.length;
    const from = b.begin();
    ctl.next();
    await b.until(() => ctl.isAnimating(), 300);
    await b.until(() => !ctl.isAnimating(), 4000);
    windows.push([from, b.end()]);
    worstFrame.push(Math.max(0, ...b.intervals.slice(seen)));
    blank.push(await b.until(() => b.allDrawn(), 4000));
    await b.sleep(dwell);
  }
  return {
    intervals: b.intervals,
    longTasks: b.longTasks,
    windows,
    blank,
    worstFrame,
    peakCanvases: b.peakCanvases,
    page: ctl.getCurrentPage(),
  };
}

/** Runs inside the page: opens the thumbnail panel, scrolls it end to end, and reports what it cost. */
async function driveThumbnails({ goTo }) {
  const b = window.__bench;
  const ctl = window.__flipbookBench.controller();
  const count = () => document.getElementsByTagName("*").length;
  const pictures = () => document.querySelectorAll("[data-thumb-page] canvas").length;
  // Open the panel far from the start of the book: the list has to find the current page.
  ctl.goToPage(goTo);
  await b.until(() => ctl.isAnimating(), 300);
  await b.until(() => !ctl.isAnimating(), 8000);
  await b.until(() => b.allDrawn(), 4000);
  await b.sleep(300);
  const renderedBefore = ctl.getCacheStats().thumbnails.entries;
  const nodesBefore = count();
  b.reset();
  const opened = performance.now();
  ctl.openPanel("thumbnails");
  await b.until(() => document.querySelector("[data-thumb-page]") !== null, 5000);
  const firstButtonMs = performance.now() - opened;
  await b.until(() => pictures() > 0, 8000);
  const firstPictureMs = performance.now() - opened;
  await b.sleep(400);
  const buttons = document.querySelectorAll("[data-thumb-page]").length;
  const nodesAdded = count() - nodesBefore;
  const restPictures = pictures();
  const thumbnailsRendered = ctl.getCacheStats().thumbnails.entries - renderedBefore;

  // The scrolling element is the nearest ancestor of a thumbnail that actually scrolls.
  let scroller = document.querySelector("[data-thumb-page]")?.parentElement ?? null;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement;
  }
  let scroll = null;
  if (scroller) {
    b.reset();
    const steps = 80;
    const from = b.begin();
    let peakPictures = 0;
    for (let step = 1; step <= steps; step += 1) {
      scroller.scrollTop = ((scroller.scrollHeight - scroller.clientHeight) * step) / steps;
      await b.sleep(40);
      peakPictures = Math.max(peakPictures, pictures());
    }
    const to = b.end();
    await b.sleep(800);
    scroll = {
      ms: to - from,
      intervals: b.intervals,
      longTasks: b.longTasks,
      windows: [[from, to]],
      peakPictures,
      pictureCanvasesAtRest: pictures(),
    };
    scroller.scrollTop = 0;
  }
  return { buttons, nodesAdded, firstButtonMs, firstPictureMs, restPictures, thumbnailsRendered, openedAt: ctl.getCurrentPage(), scroll };
}

// ---- one document size ---------------------------------------------------------------------
async function runSize(browser, browserCdp, pages, needsShim) {
  const context = await newContext(browser, needsShim);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));

  const result = { pages };
  const started = Date.now();
  await page.goto(`${config.url}/large-pdf?pages=${pages}${config.params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__flipbookBench?.firstPageAt != null, null, { timeout: 30000 });
  const load = await page.evaluate(() => ({
    documentMs: window.__flipbookBench.documentAt,
    firstPageMs: window.__flipbookBench.firstPageAt,
  }));
  result.load = { documentMs: round(load.documentMs, 0), firstPageMs: round(load.firstPageMs, 0) };
  await sleep(800);
  result.afterLoad = await snapshot(cdp, browserCdp);

  // 1. Read straight through: turn, look for a moment, turn again.
  const turned = await page.evaluate(driveTurns, { turns: config.turns, dwell: config.dwell });
  const blankOk = turned.blank.filter((v) => v !== null);
  result.turns = {
    count: config.turns,
    reachedPage: turned.page,
    frame: frameStats(turned.intervals, turned.longTasks, turned.windows),
    // The first turn pays for one-time work (compiling the page turn, the first renders).
    firstTurnWorstFrameMs: round(turned.worstFrame[0] ?? null),
    // Which turns had a frame over 50 ms, so a one-off can be told from something that repeats.
    slowTurns: turned.worstFrame.flatMap((ms, index) => (ms > 50 ? [{ turn: index + 1, ms: round(ms) }] : [])),
    worstFrameAfterFirstMs: round(Math.max(0, ...turned.worstFrame.slice(1))),
    // How long after the animation ends until every visible page has its picture.
    blankAfterTurnMs: { p50: round(quantile(blankOk, 0.5)), p95: round(quantile(blankOk, 0.95)), max: round(Math.max(0, ...blankOk)) },
    notDrawn: turned.blank.length - blankOk.length,
    peakCanvases: turned.peakCanvases,
  };
  result.afterTurns = await snapshot(cdp, browserCdp);
  result.afterTurns.cache = await page.evaluate(() => window.__flipbookBench.controller().getCacheStats());
  result.afterTurns.workers = page.workers().length;

  // 2. Jump around the book. Far targets, none inside the spread already showing.
  const random = seeded(7);
  const targets = Array.from({ length: config.jumps }, () => 6 + Math.floor(random() * (pages - 12)));
  const jumped = await page.evaluate(async ({ targets }) => {
    const b = window.__bench;
    const ctl = window.__flipbookBench.controller();
    b.reset();
    const rows = [];
    const windows = [];
    for (const target of targets) {
      await b.until(() => !ctl.isAnimating(), 5000);
      await b.sleep(250);
      if (Math.abs(ctl.getCurrentPage() - target) < 4) continue;
      const t0 = b.begin();
      ctl.goToPage(target);
      let sawAnimating = false;
      let drawnAt = null;
      let endAt = null;
      let settledAt = null;
      await b.until(() => {
        const now = performance.now();
        if (ctl.isAnimating()) sawAnimating = true;
        if (drawnAt === null && b.pageDrawn(target)) drawnAt = now;
        if (endAt === null && sawAnimating && !ctl.isAnimating()) endAt = now;
        if (drawnAt !== null && endAt !== null && b.allDrawn()) {
          settledAt = now;
          return true;
        }
        return false;
      }, 10000);
      windows.push([t0, b.end()]);
      rows.push({
        target,
        drawnMs: drawnAt === null ? null : drawnAt - t0,
        turnMs: endAt === null ? null : endAt - t0,
        blankMs: settledAt === null || endAt === null ? null : settledAt - endAt,
      });
    }
    return { rows, intervals: b.intervals, longTasks: b.longTasks, windows, peakCanvases: b.peakCanvases };
  }, { targets });
  const good = jumped.rows.filter((row) => row.drawnMs !== null && row.blankMs !== null);
  result.jumps = {
    count: good.length,
    failed: jumped.rows.length - good.length,
    // From the call to the requested page having its picture, while the turn animation plays.
    drawnMs: { p50: round(quantile(good.map((r) => r.drawnMs), 0.5)), p95: round(quantile(good.map((r) => r.drawnMs), 0.95)), max: round(Math.max(0, ...good.map((r) => r.drawnMs))) },
    // How long the reader waits after the animation ends. Zero means the pages were ready in time.
    blankAfterTurnMs: { p50: round(quantile(good.map((r) => r.blankMs), 0.5)), p95: round(quantile(good.map((r) => r.blankMs), 0.95)), max: round(Math.max(0, ...good.map((r) => r.blankMs))) },
    frame: frameStats(jumped.intervals, jumped.longTasks, jumped.windows),
    peakCanvases: jumped.peakCanvases,
  };
  result.afterJumps = await snapshot(cdp, browserCdp);

  // 3. Search every page. The query is not in the text, so every page has to be read.
  const searched = await page.evaluate(async ({ query }) => {
    const b = window.__bench;
    const ctl = window.__flipbookBench.controller();
    b.reset();
    const from = b.begin();
    await ctl.search(query);
    const to = b.end();
    const stats = ctl.getCacheStats();
    const out = { ms: to - from, intervals: b.intervals, longTasks: b.longTasks, windows: [[from, to]], text: stats.text, results: ctl.getSearchResults().length };
    ctl.clearSearch();
    return out;
  }, { query: config.query });
  result.search = {
    ms: round(searched.ms, 0),
    results: searched.results,
    indexedPages: searched.text.pages,
    indexMB: mb(searched.text.bytes),
    frame: frameStats(searched.intervals, searched.longTasks, searched.windows),
  };
  result.afterSearch = await snapshot(cdp, browserCdp);

  // 4. Open the thumbnail panel: a button for every page, a picture only for the ones in view.
  const thumbs = await page.evaluate(driveThumbnails, { goTo: Math.floor(pages * 0.4) });
  result.thumbnails = {
    buttons: thumbs.buttons,
    nodesAdded: thumbs.nodesAdded,
    firstButtonMs: round(thumbs.firstButtonMs, 0),
    firstPictureMs: round(thumbs.firstPictureMs, 0),
    picturesAtRest: thumbs.restPictures,
    openedAtPage: thumbs.openedAt,
    // Pictures rendered to show the first screen of the list. Only the ones in view are needed.
    rendered: thumbs.thumbnailsRendered,
    scroll: thumbs.scroll && {
      ms: round(thumbs.scroll.ms, 0),
      frame: frameStats(thumbs.scroll.intervals, thumbs.scroll.longTasks, thumbs.scroll.windows),
      peakPictures: thumbs.scroll.peakPictures,
      picturesAtRest: thumbs.scroll.pictureCanvasesAtRest,
    },
  };
  result.afterThumbnails = await snapshot(cdp, browserCdp);
  result.afterThumbnails.cache = await page.evaluate(() => window.__flipbookBench.controller().getCacheStats());
  // Page turns while the panel is open: every turn re-renders the list's current page.
  const withPanel = await page.evaluate(driveTurns, { turns: Math.min(15, config.turns), dwell: config.dwell });
  result.thumbnails.turnsWithPanelOpen = frameStats(withPanel.intervals, withPanel.longTasks, withPanel.windows);
  await page.evaluate(() => window.__flipbookBench.controller().closePanel());
  result.afterSearch.cache = await page.evaluate(() => window.__flipbookBench.controller().getCacheStats());
  result.problems = problems;
  result.seconds = round((Date.now() - started) / 1000, 0);
  await context.close();
  return result;
}

// ---- leaving the page ----------------------------------------------------------------------
// Opens a page by clicking a link and leaves by clicking another, so React unmounts the book
// while the document stays alive. A leak shows up as a worker, canvases, nodes or listeners that
// are still there afterwards, or a heap that keeps growing from one visit to the next.
//
// The heap of any Next.js page creeps up for the first few visits (the router, the JIT), so the
// long PDF is compared with a control page that has no PDF in it: only growth beyond the
// control's, measured over the second half of the visits, counts.
async function visitRepeatedly(browser, browserCdp, needsShim, { route, pdf }) {
  const context = await newContext(browser, needsShim);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(`${config.url}/`, { waitUntil: "load" });
  await sleep(500);
  const baseline = await snapshot(cdp, browserCdp);

  const cycles = [];
  for (let cycle = 1; cycle <= config.cycles; cycle += 1) {
    await page.click(`nav.demo-nav a[href="${route}"]`);
    let canvasesDuring = 0;
    if (pdf) {
      await page.waitForFunction(() => window.__flipbookBench?.firstPageAt != null, null, { timeout: 30000 });
      canvasesDuring = await page.evaluate(async () => {
        const b = window.__bench;
        const ctl = window.__flipbookBench.controller();
        for (let i = 0; i < 8; i += 1) {
          ctl.next();
          await b.until(() => !ctl.isAnimating(), 4000);
          await b.until(() => b.allDrawn(), 4000);
        }
        await ctl.search("qwxz");
        return document.querySelectorAll("canvas").length;
      });
    } else {
      await sleep(1500);
    }
    const workersDuring = page.workers().length;
    await page.click('nav.demo-nav a[href="/"]');
    await page
      .waitForFunction(() => window.__flipbookBench === undefined && document.querySelectorAll("canvas").length === 0, null, { timeout: 10000 })
      .catch(() => undefined);
    await sleep(600);
    const after = await snapshot(cdp, browserCdp);
    const left = await page.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      hookLeft: window.__flipbookBench !== undefined,
    }));
    cycles.push({ cycle, canvasesDuring, workersDuring, workersAfter: page.workers().length, ...left, ...after });
  }
  await context.close();
  return { baseline, cycles };
}

/** MB gained per visit over the second half of the visits, once the warm-up is over. */
function heapSlope(cycles) {
  const from = Math.floor(cycles.length / 2);
  return (cycles[cycles.length - 1].heapMB - cycles[from].heapMB) / (cycles.length - 1 - from);
}

async function runCleanup(browser, browserCdp, needsShim) {
  const control = await visitRepeatedly(browser, browserCdp, needsShim, { route: "/images", pdf: false });
  const long = await visitRepeatedly(browser, browserCdp, needsShim, { route: "/large-pdf", pdf: true });
  const { cycles } = long;
  const first = cycles[0];
  const last = cycles[cycles.length - 1];
  const slope = { pdf: round(heapSlope(cycles), 3), control: round(heapSlope(control.cycles), 3) };
  const leaks = [];
  if (cycles.some((c) => c.workersDuring === 0)) leaks.push("no PDF.js worker was seen while a book was open, so the worker checks prove nothing");
  if (cycles.some((c) => c.workersAfter > 0)) leaks.push(`${Math.max(...cycles.map((c) => c.workersAfter))} PDF.js worker(s) still running after leaving`);
  if (cycles.some((c) => c.canvases > 0)) leaks.push("canvases left in the page after leaving");
  if (cycles.some((c) => c.hookLeft)) leaks.push("the benchmark hook was left behind (the demo page did not unmount)");
  // Nodes and listeners are exact for the same page, so a small allowance covers the router.
  if (last.nodes - first.nodes > 40) leaks.push(`DOM nodes grew by ${last.nodes - first.nodes} between visit 1 and ${config.cycles}`);
  if (last.listeners - first.listeners > 20) leaks.push(`event listeners grew by ${last.listeners - first.listeners} between visit 1 and ${config.cycles}`);
  if (cycles.length >= 4 && slope.pdf - slope.control > 0.15) {
    leaks.push(`page heap grew ${slope.pdf} MB per visit against ${slope.control} MB for a page with no PDF`);
  }
  return { baseline: long.baseline, cycles, control: control.cycles, slope, leaks };
}

// ---- main ----------------------------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: config.chromium,
  args: ["--no-sandbox", "--js-flags=--expose-gc"],
});
const browserCdp = await browser.newBrowserCDPSession();

let needsShim = config.polyfill === "on";
if (config.polyfill === "auto") {
  const probePage = await browser.newPage();
  needsShim = await probePage.evaluate(() => typeof Map.prototype.getOrInsertComputed !== "function");
  await probePage.context().close();
}
const report = {
  when: new Date().toISOString(),
  browser: browser.version(),
  shim: needsShim,
  config: { ...config, chromium: undefined },
  sizes: [],
  cleanup: null,
};
console.log(`Chromium ${report.browser}, ${config.width}x${config.height} @${config.dpr}x, ${config.url}`);
if (needsShim) console.log("This browser lacks Map.prototype.getOrInsertComputed, so a test-only shim is applied (page and PDF.js worker).");

for (const pages of config.pages) {
  process.stdout.write(`\n== ${pages} pages ==\n`);
  const result = await runSize(browser, browserCdp, pages, needsShim);
  report.sizes.push(result);
  const t = result.turns;
  const j = result.jumps;
  console.log(`load           document ${result.load.documentMs} ms, first page ${result.load.firstPageMs} ms (from navigation start)`);
  console.log(`turns (${t.count})     ${t.frame.fps} fps, frame p50 ${t.frame.p50} / p95 ${t.frame.p95} / p99 ${t.frame.p99} / max ${t.frame.max} ms; >25 ms: ${t.frame.over25}, >50 ms: ${t.frame.over50}; long tasks ${t.frame.longTasks} (${t.frame.longTaskMs} ms)`);
  console.log(`               worst frame: first turn ${t.firstTurnWorstFrameMs} ms, every later turn ${t.worstFrameAfterFirstMs} ms${t.slowTurns.length ? `; turns over 50 ms: ${t.slowTurns.map((x) => `#${x.turn} (${x.ms})`).join(", ")}` : ""}`);
  console.log(`               pages drawn after the turn ends: p50 ${t.blankAfterTurnMs.p50} / p95 ${t.blankAfterTurnMs.p95} / max ${t.blankAfterTurnMs.max} ms${t.notDrawn ? `, ${t.notDrawn} never drawn` : ""}; peak canvases ${t.peakCanvases}`);
  console.log(`jumps (${j.count})     requested page drawn after p50 ${j.drawnMs.p50} / p95 ${j.drawnMs.p95} ms; blank after the turn p50 ${j.blankAfterTurnMs.p50} / p95 ${j.blankAfterTurnMs.p95} / max ${j.blankAfterTurnMs.max} ms${j.failed ? `; ${j.failed} failed` : ""}`);
  console.log(`               frame p95 ${j.frame.p95} / max ${j.frame.max} ms; peak canvases ${j.peakCanvases}`);
  console.log(`search         ${result.search.ms} ms for ${result.search.indexedPages} pages, index ${result.search.indexMB} MB; frame max ${result.search.frame.max} ms, long tasks ${result.search.frame.longTasks} (${result.search.frame.longTaskMs} ms)`);
  const c = result.afterTurns.cache;
  console.log(`cache          ${c.pages.entries} pages / ${mb(c.pages.bytes)} MB (peak ${c.pages.peakEntries} / ${mb(c.pages.peakBytes)} MB), hit rate ${Math.round((c.pages.hits / Math.max(1, c.pages.hits + c.pages.misses)) * 100)}%, evicted ${c.pages.evictions}`);
  const th = result.thumbnails;
  console.log(`thumbnails     opened at page ${th.openedAtPage}: ${th.buttons} buttons, +${th.nodesAdded} DOM nodes; first button ${th.firstButtonMs} ms, first picture ${th.firstPictureMs} ms; ${th.rendered} pictures rendered, ${th.picturesAtRest} showing`);
  if (th.scroll) {
    console.log(`               scrolled end to end in ${th.scroll.ms} ms: frame p95 ${th.scroll.frame.p95} / max ${th.scroll.frame.max} ms, long tasks ${th.scroll.frame.longTasks} (${th.scroll.frame.longTaskMs} ms); pictures alive peak ${th.scroll.peakPictures}, at rest ${th.scroll.picturesAtRest}`);
  } else {
    console.log("               (could not find the scrolling element)");
  }
  console.log(`               turns with the panel open: ${th.turnsWithPanelOpen.fps} fps, frame p95 ${th.turnsWithPanelOpen.p95} / max ${th.turnsWithPanelOpen.max} ms, long tasks ${th.turnsWithPanelOpen.longTasks} (${th.turnsWithPanelOpen.longTaskMs} ms)`);
  const tc = result.afterThumbnails.cache.thumbnails;
  console.log(`               thumbnail cache ${tc.entries} pictures / ${mb(tc.bytes)} MB (peak ${tc.peakEntries} / ${mb(tc.peakBytes)} MB), evicted ${tc.evictions}`);
  for (const key of ["afterLoad", "afterTurns", "afterJumps", "afterSearch", "afterThumbnails"]) {
    const s = result[key];
    console.log(`${key.padEnd(14)} heap ${s.heapMB} MB, nodes ${s.nodes}, listeners ${s.listeners}, browser RSS ${s.rssMB ?? "n/a"} MB`);
  }
  if (result.problems.length > 0) console.log(`console errors: ${result.problems.join(" | ")}`);
}

if (config.cleanup) {
  process.stdout.write("\n== leaving the page ==\n");
  report.cleanup = await runCleanup(browser, browserCdp, needsShim);
  const b = report.cleanup.baseline;
  console.log(`before         heap ${b.heapMB} MB, nodes ${b.nodes}, listeners ${b.listeners}, documents ${b.documents}`);
  for (const c of report.cleanup.cycles) {
    console.log(`visit ${String(c.cycle).padEnd(2)}       workers ${c.workersDuring} -> ${c.workersAfter}, canvases ${c.canvasesDuring} -> ${c.canvases}; after: heap ${c.heapMB} MB, nodes ${c.nodes}, listeners ${c.listeners}, RSS ${c.rssMB ?? "n/a"} MB`);
  }
  const heaps = (rows) => rows.map((c) => c.heapMB).join(", ");
  console.log(`control page   heap after each visit: ${heaps(report.cleanup.control)} MB`);
  console.log(`heap per visit once warmed up: ${report.cleanup.slope.pdf} MB for the PDF page, ${report.cleanup.slope.control} MB for a page with no PDF`);
  console.log(report.cleanup.leaks.length === 0 ? "no leaks found" : `LEAKS:\n  - ${report.cleanup.leaks.join("\n  - ")}`);
}

await browser.close();
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));
process.exit(report.cleanup && report.cleanup.leaks.length > 0 ? 1 : 0);
