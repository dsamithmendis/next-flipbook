// Headless benchmark of the PDF pipeline: load, first page, render time, a read-through with
// prefetch, random jumps, search, memory and teardown. It drives the real PdfManager and
// PdfSession from the built package, with real pdf.js and a native canvas.
//
//   npm run build -w next-flipbook
//   node --expose-gc benchmarks/pipeline.mjs [--pages=10,50,100,500,1000] [--json=out.json]
//        [--cache=10] [--radius=2] [--width=600] [--dpr=1] [--dwell=100] [--turns=100] [--jumps=40]
//
// Every size runs in its own process, so memory numbers are not polluted by earlier sizes.
//
// This runs in Node, where PDF.js parses on the main thread. Time to first page is therefore
// an upper bound for a browser, which parses in a worker. See benchmarks/browser.mjs for that.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeBigPdf } from "./lib/big-pdf.mjs";

const require = createRequire(import.meta.url);
const { PdfManager } = await import("../packages/flipbook/dist/pdf/manager.js");
const { SearchController } = await import("../packages/flipbook/dist/core/search/SearchController.js");
const napi = await import("@napi-rs/canvas");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const config = {
  pages: (args.pages ?? "10,50,100,500,1000").split(",").map(Number),
  cache: Number(args.cache ?? 10),
  radius: Number(args.radius ?? 2),
  width: Number(args.width ?? 600),
  dpr: Number(args.dpr ?? 1),
  dwell: Number(args.dwell ?? 100),
  turns: Number(args.turns ?? 100),
  jumps: Number(args.jumps ?? 40),
  fastDwell: Number(args.fastdwell ?? 25),
  rapidDwell: Number(args.rapiddwell ?? 5),
  // A term that is not in the text, so the search has to read every page.
  query: args.query ?? "qwxz",
};

const gc = globalThis.gc ?? (() => undefined);

const workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
const pdfOptions = {
  loadPdfjs: () => import("pdfjs-dist/legacy/build/pdf.mjs"),
  workerSrc,
  // pdf.js logs a font warning in Node for the standard fonts; the pages still render.
  documentParams: { verbosity: 0 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const ms = (value) => Math.round(value * 10) / 10;
function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
function memory() {
  const m = process.memoryUsage();
  return { heap: m.heapUsed, native: m.external + m.arrayBuffers, rss: m.rss };
}
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Tracks how many canvases are alive: one is released when the cache shrinks it to nothing.
const canvases = { created: 0, alive: 0, peak: 0 };
function createCanvas(width, height) {
  const real = napi.createCanvas(width, height);
  canvases.created += 1;
  canvases.alive += 1;
  canvases.peak = Math.max(canvases.peak, canvases.alive);
  let released = false;
  return new Proxy(real, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if ((prop === "width" || prop === "height") && value === 0 && !released) {
        released = true;
        canvases.alive -= 1;
      }
      return Reflect.set(target, prop, value, target);
    },
  });
}

async function waitReady(session) {
  while (session.getSnapshot().status === "loading") await sleep(2);
  const { status, error } = session.getSnapshot();
  if (status !== "ready") throw new Error(`PDF did not open: ${status} ${error?.message ?? ""}`);
}

async function runSize(pageCount) {
  const bytes = makeBigPdf({ pages: pageCount });
  const result = { pages: pageCount, pdfKB: Math.round(bytes.length / 1024) };

  canvases.created = 0;
  canvases.alive = 0;
  canvases.peak = 0;
  gc();
  const before = memory();
  let renders = 0;
  const manager = new PdfManager(
    {
      options: () => pdfOptions,
      events: () => ({ onPageLoaded: () => (renders += 1) }),
      cacheSize: () => config.cache,
    },
    { createCanvas, getDevicePixelRatio: () => config.dpr },
  );
  manager.setViewportWidth(config.width);
  const resolve = (position) => ({ source: bytes, page: position });
  const requestPage = (page) => session.request(page, { position: page, cssWidth: config.width });
  let peakRss = before.rss;
  const sampleRss = () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };

  // ---- load and first page --------------------------------------------------
  const t0 = performance.now();
  manager.sync([bytes]);
  const session = manager.getSession(bytes);
  await waitReady(session);
  result.loadMs = ms(performance.now() - t0);
  const t1 = performance.now();
  await requestPage(1);
  result.firstPageMs = ms(performance.now() - t1);
  result.timeToFirstPageMs = ms(result.loadMs + result.firstPageMs);
  manager.cache.clear();

  // ---- render time of single pages, spread across the document --------------
  const samples = [];
  const stride = Math.max(1, Math.floor(pageCount / 24));
  for (let page = 1; page <= pageCount && samples.length < 24; page += stride) {
    const start = performance.now();
    await requestPage(page);
    samples.push(performance.now() - start);
    manager.cache.delete(session.keyFor(page, config.width));
  }
  result.renderMsMedian = ms(quantile(samples, 0.5));
  result.renderMsP95 = ms(quantile(samples, 0.95));
  manager.cache.clear();

  // ---- reading through the book, spread by spread ---------------------------
  // One scenario = a run of turns from `first`, `step` pages at a time, pausing `dwell` ms on each
  // spread. "Blank" means a visible page was not ready the moment the reader arrived.
  async function readThrough({ first, step, turns, dwell }) {
    manager.cache.clear();
    manager.cache.resetStats();
    renders = 0;
    const waits = [];
    let blank = 0;
    let done = 0;
    for (let turn = 0; turn < turns; turn += 1) {
      const left = first + turn * step;
      const visible = [left, left + 1].filter((page) => page >= 1 && page <= pageCount);
      if (visible.length === 0) break;
      manager.focus({ visible, total: pageCount, radius: config.radius, resolve });
      const ready = visible.every((page) => manager.cache.peek(session.keyFor(page, config.width)));
      if (!ready) blank += 1;
      const start = performance.now();
      await Promise.all(visible.map(requestPage));
      waits.push(performance.now() - start);
      done += 1;
      sampleRss();
      await sleep(dwell);
    }
    const stats = manager.cache.stats();
    return {
      turns: done,
      blankTurns: blank,
      waitMsMedian: ms(quantile(waits, 0.5)),
      waitMsP95: ms(quantile(waits, 0.95)),
      rendered: renders,
      // Pages drawn per page read: 1 is perfect, more is wasted work.
      rendersPerPageRead: Math.round((renders / Math.max(1, done * 2)) * 100) / 100,
      hits: stats.hits,
      misses: stats.misses,
      hitRate:
        stats.hits + stats.misses === 0 ? 0 : Math.round((stats.hits / (stats.hits + stats.misses)) * 1000) / 10,
      evictions: stats.evictions,
      peakEntries: stats.peakEntries,
      peakCacheMB: mb(stats.peakBytes),
    };
  }

  const forwardTurns = Math.min(config.turns, Math.max(1, Math.floor((pageCount - 1) / 2)));
  result.read = await readThrough({ first: 2, step: 2, turns: forwardTurns, dwell: config.dwell });
  result.canvasesCreated = canvases.created;
  result.canvasesAlive = canvases.alive;
  result.canvasesPeak = canvases.peak;
  const fastTurns = Math.min(60, forwardTurns);
  result.fast = await readThrough({ first: 2, step: 2, turns: fastTurns, dwell: config.fastDwell });
  const backFrom = Math.max(2, pageCount - (pageCount % 2 === 0 ? 1 : 0) - 1);
  result.backward = await readThrough({
    first: pageCount > 8 ? backFrom : 2,
    step: pageCount > 8 ? -2 : 2,
    turns: Math.min(40, forwardTurns),
    dwell: config.dwell,
  });

  // What is still held after reading 200 or so pages, once the garbage collector has run.
  await sleep(150);
  gc();
  result.heapAfterReadMB = mb(memory().heap - before.heap);

  // ---- random jumps ----------------------------------------------------------
  const rand = random(7);
  const jumps = [];
  for (let jump = 0; jump < config.jumps && pageCount > 4; jump += 1) {
    const target = 2 + Math.floor(rand() * Math.max(1, pageCount - 3));
    const visible = [target, Math.min(pageCount, target + 1)];
    manager.focus({ visible, total: pageCount, radius: config.radius, resolve });
    const start = performance.now();
    await Promise.all(visible.map(requestPage));
    jumps.push(performance.now() - start);
    sampleRss();
    await sleep(config.dwell);
  }
  result.jumpMsMedian = ms(quantile(jumps, 0.5));
  result.jumpMsP95 = ms(quantile(jumps, 0.95));

  // Jumping again before the last jump's prefetch has finished, as when dragging a scrubber.
  const rapid = [];
  const rapidRand = random(11);
  for (let jump = 0; jump < config.jumps && pageCount > 4; jump += 1) {
    const target = 2 + Math.floor(rapidRand() * Math.max(1, pageCount - 3));
    const visible = [target, Math.min(pageCount, target + 1)];
    manager.focus({ visible, total: pageCount, radius: config.radius, resolve });
    const start = performance.now();
    await Promise.all(visible.map(requestPage));
    rapid.push(performance.now() - start);
    await sleep(config.rapidDwell);
  }
  result.rapidMsMedian = ms(quantile(rapid, 0.5));
  result.rapidMsP95 = ms(quantile(rapid, 0.95));

  // ---- search the whole document -------------------------------------------
  await sleep(200);
  gc();
  const beforeSearch = memory();
  const search = new SearchController();
  search.setSource({ total: pageCount, getText: (position, signal) => session.getPageText(position, signal) });
  const s0 = performance.now();
  const outcome = await search.search(config.query, { startPosition: 1 });
  sampleRss();
  result.search = {
    ms: ms(performance.now() - s0),
    msPerPage: ms((performance.now() - s0) / pageCount),
    scanned: outcome.scanned,
    results: outcome.results.length,
    truncated: outcome.truncated,
    // How much extracted text the session is still holding when the search is over.
    // (Older builds without getMemoryStats report only the page count.)
    cachedPages: session.getMemoryStats?.().textPages ?? session.texts?.size ?? null,
    cachedMB: session.getMemoryStats ? mb(session.getMemoryStats().textBytes) : null,
  };
  gc();
  const afterSearch = memory();
  result.search.heapGrowthMB = mb(afterSearch.heap - beforeSearch.heap);

  // ---- memory, then teardown --------------------------------------------------
  result.memory = {
    heapAfterReadMB: result.heapAfterReadMB,
    heapAfterSearchMB: mb(afterSearch.heap - before.heap),
    peakRssMB: mb(peakRss),
    rssGrowthMB: mb(peakRss - before.rss),
  };
  search.clear();
  manager.dispose();
  await sleep(100);
  gc();
  await sleep(50);
  gc();
  const after = memory();
  result.afterDispose = {
    canvasesAlive: canvases.alive,
    heapDeltaMB: mb(after.heap - before.heap),
    nativeDeltaMB: mb(after.native - before.native),
  };
  return result;
}

async function warmUp() {
  // Loads pdf.js and the worker module once so the first size is not charged for it.
  const cold = performance.now();
  const bytes = makeBigPdf({ pages: 2 });
  const manager = new PdfManager(
    { options: () => pdfOptions, events: () => ({}), cacheSize: () => 4 },
    { createCanvas, getDevicePixelRatio: () => 1 },
  );
  manager.setViewportWidth(300);
  manager.sync([bytes]);
  const session = manager.getSession(bytes);
  await waitReady(session);
  await session.request(1, { position: 1, cssWidth: 300 });
  manager.dispose();
  return ms(performance.now() - cold);
}

// ---- child: measure one size and print it as a single line ------------------
if (args.child) {
  const coldStartMs = await warmUp();
  const result = await runSize(config.pages[0]);
  console.log("RESULT " + JSON.stringify({ coldStartMs, result }));
  process.exit(0);
}

// ---- parent: one fresh process per size, then one table ----------------------
const forwarded = process.argv.slice(2).filter((arg) => !arg.startsWith("--pages=") && !arg.startsWith("--json="));
const results = [];
let coldStartMs = 0;
for (const pageCount of config.pages) {
  process.stdout.write(`${String(pageCount).padStart(5)} pages ... `);
  const run = spawnSync(
    process.execPath,
    ["--expose-gc", fileURLToPath(import.meta.url), ...forwarded, `--pages=${pageCount}`, "--child=1"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) {
    console.log("failed");
    console.error(run.stderr || run.stdout);
    process.exit(1);
  }
  const parsed = JSON.parse(line.slice(7));
  if (results.length === 0) coldStartMs = parsed.coldStartMs;
  results.push(parsed.result);
  const r = parsed.result;
  console.log(`first page ${r.timeToFirstPageMs} ms, ${r.read.blankTurns}/${r.read.turns} blank turns`);
}

const row = (label, pick) => `${label.padEnd(36)}${results.map((r) => String(pick(r)).padStart(10)).join("")}`;
const section = (title) => console.log(`\n${title}`);
console.log(`\nConfig: ${JSON.stringify({ ...config, pages: undefined })}  cold start ${coldStartMs} ms`);
console.log("\n" + "".padEnd(36) + results.map((r) => `${r.pages} pp`.padStart(10)).join(""));
console.log(row("PDF size (KB)", (r) => r.pdfKB));
section("Opening");
console.log(row("open document (ms)", (r) => r.loadMs));
console.log(row("first page rendered (ms)", (r) => r.firstPageMs));
console.log(row("time to first page (ms)", (r) => r.timeToFirstPageMs));
console.log(row("render one page, median (ms)", (r) => r.renderMsMedian));
console.log(row("render one page, p95 (ms)", (r) => r.renderMsP95));
for (const [key, title] of [
  ["read", `Reading forward, ${config.dwell} ms a spread`],
  ["fast", `Flipping forward fast, ${config.fastDwell} ms a spread`],
  ["backward", `Reading backward, ${config.dwell} ms a spread`],
]) {
  section(title);
  console.log(row("blank turns", (r) => `${r[key].blankTurns}/${r[key].turns}`));
  console.log(row("wait for the spread, p95 (ms)", (r) => r[key].waitMsP95));
  console.log(row("pages drawn per page read", (r) => r[key].rendersPerPageRead));
  console.log(row("cache hit rate (%)", (r) => r[key].hitRate));
  console.log(row("evictions", (r) => r[key].evictions));
  console.log(row("peak cache entries", (r) => r[key].peakEntries));
}
section("Jumping to a random page");
console.log(row("p50 (ms)", (r) => r.jumpMsMedian));
console.log(row("p95 (ms)", (r) => r.jumpMsP95));
section(`Jumping again within ${config.rapidDwell} ms`);
console.log(row("p50 (ms)", (r) => r.rapidMsMedian));
console.log(row("p95 (ms)", (r) => r.rapidMsP95));
section(`Searching every page for "${config.query}"`);
console.log(row("pages scanned", (r) => r.search.scanned));
console.log(row("time (ms)", (r) => r.search.ms));
console.log(row("heap growth (MB)", (r) => r.search.heapGrowthMB));
console.log(row("pages of text still cached", (r) => r.search.cachedPages));
console.log(row("text still cached (MB)", (r) => r.search.cachedMB));
console.log(row("heap after search, total (MB)", (r) => r.memory.heapAfterSearchMB));
section("Memory");
console.log(row("heap after reading (MB)", (r) => r.heapAfterReadMB));
console.log(row("canvases created", (r) => r.canvasesCreated));
console.log(row("canvases alive after reading", (r) => r.canvasesAlive));
console.log(row("canvases peak alive", (r) => r.canvasesPeak));
console.log(row("peak cache (MB)", (r) => r.read.peakCacheMB));
console.log(row("peak RSS growth (MB)", (r) => r.memory.rssGrowthMB));
section("After dispose");
console.log(row("canvases alive", (r) => r.afterDispose.canvasesAlive));
console.log(row("heap delta (MB)", (r) => r.afterDispose.heapDeltaMB));
console.log(row("native delta (MB)", (r) => r.afterDispose.nativeDeltaMB));

if (args.json) writeFileSync(args.json, JSON.stringify({ config, coldStartMs, results }, null, 2));
process.exit(0);
