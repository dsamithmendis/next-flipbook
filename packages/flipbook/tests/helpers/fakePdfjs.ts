import type {
  PdfDocumentInit,
  PdfDocumentProxy,
  PdfLoadingTask,
  PdfPageProxy,
  PdfjsModule,
} from "../../src/pdf/types.js";

export interface FakeRender {
  docPage: number;
  /** Pixels per point the page was asked to render at. */
  scale: number;
  cancelled: boolean;
  settled: boolean;
  finish(): void;
  fail(error: unknown): void;
}

export interface FakeTextItem {
  str: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface FakePdfConfig {
  numPages?: number;
  pageWidth?: number;
  pageHeight?: number;
  /** Makes the document encrypted with this password. */
  password?: string;
  /** `getDocument` rejects with this. */
  loadError?: unknown;
  /** Renders finish on their own. Default: they wait for `finish()`. */
  autoRender?: boolean;
  /** Doc pages whose render fails. */
  failRenderOf?: number[];
  progress?: { loaded: number; total: number };
  /** Text by page. A string becomes one item near the top of the page. */
  text?: Record<number, FakeTextItem[] | string>;
  /** Raw annotations by page, as PDF.js returns them. */
  annotations?: Record<number, Array<Record<string, unknown>>>;
  outline?: Array<Record<string, unknown>>;
  /** Named destinations. */
  destinations?: Record<string, unknown[]>;
}

/** A controllable stand-in for pdfjs-dist, so loading and rendering logic can be tested exactly. */
export function createFakePdfjs(config: FakePdfConfig = {}) {
  const renders: FakeRender[] = [];
  const stats = {
    initCalls: [] as PdfDocumentInit[],
    tasksDestroyed: 0,
    docsDestroyed: 0,
    pageCleanups: 0,
    textReads: 0,
    annotationReads: 0,
    outlineReads: 0,
    /** Times `cleanup()` was called on the document. */
    cleanups: 0,
    /** Cleanups that began while a render was still running. PDF.js forbids this. */
    cleanupWhileRendering: 0,
    /** Pages opened or rendered while a cleanup was in flight. PDF.js forbids this too. */
    workDuringCleanup: 0,
  };
  let cleaning = false;
  const numPages = config.numPages ?? 6;
  const pageWidth = config.pageWidth ?? 612;
  const pageHeight = config.pageHeight ?? 792;

  function makePage(docPage: number): PdfPageProxy {
    return {
      getViewport: ({ scale }) => ({
        width: pageWidth * scale,
        height: pageHeight * scale,
        transform: [scale, 0, 0, -scale, 0, pageHeight * scale],
      }),
      async getTextContent() {
        stats.textReads += 1;
        const entry = config.text?.[docPage] ?? [];
        const items: FakeTextItem[] =
          typeof entry === "string" ? [{ str: entry, x: 72, y: 700, width: entry.length * 6, height: 12 }] : entry;
        return {
          items: items.map((item) => ({
            str: item.str,
            transform: [item.height ?? 12, 0, 0, item.height ?? 12, item.x ?? 72, item.y ?? 700],
            width: item.width ?? item.str.length * 6,
            height: item.height ?? 12,
            ...(item.hasEOL ? { hasEOL: true } : {}),
          })),
        };
      },
      async getAnnotations() {
        stats.annotationReads += 1;
        return config.annotations?.[docPage] ?? [];
      },
      render({ viewport }) {
        if (cleaning) stats.workDuringCleanup += 1;
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        const record: FakeRender = {
          docPage,
          scale: viewport.width / pageWidth,
          cancelled: false,
          settled: false,
          finish() {
            if (record.settled) return;
            record.settled = true;
            resolve();
          },
          fail(error) {
            if (record.settled) return;
            record.settled = true;
            reject(error);
          },
        };
        renders.push(record);
        if (config.failRenderOf?.includes(docPage)) {
          queueMicrotask(() => record.fail(new Error("render exploded")));
        } else if (config.autoRender) {
          queueMicrotask(() => record.finish());
        }
        return {
          promise,
          cancel() {
            record.cancelled = true;
            record.fail(Object.assign(new Error("cancelled"), { name: "RenderingCancelledException" }));
          },
        };
      },
      cleanup() {
        stats.pageCleanups += 1;
      },
    };
  }

  function makeDocument(): PdfDocumentProxy {
    return {
      numPages,
      getPage: (page) => {
        if (cleaning) stats.workDuringCleanup += 1;
        return Promise.resolve(makePage(page));
      },
      async cleanup() {
        stats.cleanups += 1;
        stats.cleanupWhileRendering += renders.filter((render) => !render.settled).length;
        cleaning = true;
        await new Promise((resolve) => setTimeout(resolve, 0));
        cleaning = false;
      },
      async getOutline() {
        stats.outlineReads += 1;
        return (config.outline as never) ?? null;
      },
      async getDestination(id) {
        return config.destinations?.[id] ?? null;
      },
      async getPageIndex(ref) {
        const page = (ref as { page?: number } | null)?.page;
        if (typeof page !== "number") throw new Error("unknown page reference");
        return page - 1;
      },
      destroy() {
        stats.docsDestroyed += 1;
        return Promise.resolve();
      },
    };
  }

  const pdfjs: PdfjsModule = {
    version: "0.0.0-test",
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument(init) {
      stats.initCalls.push(init);
      let destroyed = false;
      let resolveLoad!: (doc: PdfDocumentProxy) => void;
      let rejectLoad!: (reason: unknown) => void;
      const task: PdfLoadingTask = {
        promise: new Promise<PdfDocumentProxy>((res, rej) => {
          resolveLoad = res;
          rejectLoad = rej;
        }),
        onPassword: null,
        onProgress: null,
        destroy() {
          stats.tasksDestroyed += 1;
          destroyed = true;
          rejectLoad(new Error("Loading aborted"));
          return Promise.resolve();
        },
      };

      const finish = (): void => {
        if (!destroyed) resolveLoad(makeDocument());
      };
      const ask = (reason: number): void => {
        task.onPassword?.((password) => {
          if (password === config.password) finish();
          else ask(2);
        }, reason);
      };

      // Handlers are assigned right after getDocument returns, so act on the next tick.
      setTimeout(() => {
        if (destroyed) return;
        if (config.loadError !== undefined) {
          rejectLoad(config.loadError);
          return;
        }
        if (config.progress) task.onProgress?.(config.progress);
        if (config.password === undefined || init.password === config.password) finish();
        else ask(init.password === undefined ? 1 : 2);
      }, 0);

      return task;
    },
  };

  return { pdfjs, loadPdfjs: () => Promise.resolve(pdfjs), renders, stats };
}

export const fakeCanvas = (width: number, height: number): HTMLCanvasElement =>
  ({ width, height, isConnected: false, style: {}, getContext: () => ({}) }) as unknown as HTMLCanvasElement;

/** Lets pending promise chains and zero-delay timers run. */
export async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
