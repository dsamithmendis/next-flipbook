"use client";

import { FlipBook, type FlipBookCacheStats, type FlipBookController } from "next-flipbook";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Nav } from "../Nav";

const SIZES = [100, 500, 1000] as const;

/** What `benchmarks/browser.mjs` reads. Harmless in a real page: it only exposes the controller. */
interface BenchHook {
  controller: () => FlipBookController | null;
  /** performance.now() when the first page finished drawing. */
  firstPageAt: number | null;
  /** performance.now() when the document finished opening. */
  documentAt: number | null;
  pagesDrawn: number;
}
declare global {
  interface Window {
    __flipbookBench?: BenchHook;
  }
}

interface Live {
  canvases: number;
  heapMB: number | null;
  cache: FlipBookCacheStats;
}

const ADDRESS_CHANGED = "large-pdf-address";

const readAddress = (): string => window.location.search;

function subscribeToAddress(notify: () => void): () => void {
  window.addEventListener("popstate", notify);
  window.addEventListener(ADDRESS_CHANGED, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(ADDRESS_CHANGED, notify);
  };
}

const mb = (bytes: number): string => (bytes / 1048576).toFixed(1);

export default function LargePdfDemo() {
  // The size, and `?cleanup=0` to turn off the idle release of PDF.js memory (to compare with and
  // without it), live in the address. The server does not know it, so the first render has none
  // and the page fills in once it is on screen.
  const search = useSyncExternalStore<string | null>(subscribeToAddress, readAddress, () => null);
  const params = search === null ? null : new URLSearchParams(search);
  const wanted = Number(params?.get("pages"));
  const pages = params === null ? null : (SIZES as readonly number[]).includes(wanted) ? wanted : 500;
  const cleanup = params?.get("cleanup") !== "0";
  const [live, setLive] = useState<Live | null>(null);
  const ref = useRef<FlipBookController>(null);

  const hook = useCallback((): BenchHook => {
    window.__flipbookBench ??= {
      controller: () => ref.current,
      firstPageAt: null,
      documentAt: null,
      pagesDrawn: 0,
    };
    return window.__flipbookBench;
  }, []);

  useEffect(() => {
    if (pages === null) return;
    window.__flipbookBench = {
      controller: () => ref.current,
      firstPageAt: null,
      documentAt: null,
      pagesDrawn: 0,
    };
    const timer = window.setInterval(() => {
      const controller = ref.current;
      if (!controller) return;
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      setLive({
        canvases: document.querySelectorAll("canvas").length,
        heapMB: memory ? Number(mb(memory.usedJSHeapSize)) : null,
        cache: controller.getCacheStats(),
      });
    }, 500);
    return () => {
      window.clearInterval(timer);
      delete window.__flipbookBench;
    };
  }, [pages]);

  const select = (size: number): void => {
    const url = new URL(window.location.href);
    url.searchParams.set("pages", String(size));
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(ADDRESS_CHANGED));
  };

  const hits = live ? live.cache.pages.hits : 0;
  const lookups = live ? live.cache.pages.hits + live.cache.pages.misses : 0;

  return (
    <main>
      <h1>A very long PDF</h1>
      <p className="lede">
        {pages ?? "…"} pages of dense text, generated for this demo. However long the PDF is, only the pages near
        the one you are reading are drawn: watch the canvases and the cache below while you turn pages, jump with
        the thumbnails, or search the whole document.
      </p>
      <Nav />

      <div style={{ display: "flex", gap: 8, margin: "0 0 12px", flexWrap: "wrap" }}>
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => select(size)}
            aria-pressed={pages === size}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: pages === size ? "var(--ink)" : "transparent",
              color: pages === size ? "var(--paper)" : "var(--ink)",
              font: "14px system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            {size} pages
          </button>
        ))}
      </div>

      {pages !== null ? (
        <FlipBook
          key={pages}
          ref={ref}
          source={`/large-${pages}.pdf`}
          pdf={{ workerSrc: "/pdf.worker.min.mjs", ...(cleanup ? {} : { cleanupAfterPages: 0 }) }}
          cover
          thumbnails
          search
          outline
          bookmarks
          urlState
          height="70vh"
          cacheSize={10}
          preloadPages={2}
          onDocumentLoaded={() => {
            hook().documentAt = performance.now();
          }}
          onPageLoaded={() => {
            const bench = hook();
            bench.pagesDrawn += 1;
            bench.firstPageAt ??= performance.now();
          }}
        />
      ) : null}

      <dl
        data-testid="live-stats"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "8px 24px",
          margin: "16px 0 0",
          font: "13px/1.4 system-ui, sans-serif",
        }}
      >
        <Stat label="Pages in the book" value={pages === null ? "…" : String(pages)} />
        <Stat label="Canvases in the page" value={live ? String(live.canvases) : "…"} />
        <Stat
          label="Page cache"
          value={live ? `${live.cache.pages.entries} pages, ${mb(live.cache.pages.bytes)} MB` : "…"}
        />
        <Stat label="Evicted so far" value={live ? String(live.cache.pages.evictions) : "…"} />
        <Stat label="Cache hit rate" value={lookups === 0 ? "…" : `${Math.round((hits / lookups) * 100)}%`} />
        <Stat
          label="Search index"
          value={live ? `${live.cache.text.pages} pages, ${mb(live.cache.text.bytes)} MB` : "…"}
        />
        <Stat label="JS heap" value={live?.heapMB != null ? `${live.heapMB} MB` : "n/a in this browser"} />
      </dl>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ color: "var(--muted)" }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
    </div>
  );
}
