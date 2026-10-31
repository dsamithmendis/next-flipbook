import { describe, expect, it } from "vitest";
import { FlipBookRuntimeError } from "../src/core/errors.js";
import { CancelledError, isCancellation, mapPdfError } from "../src/pdf/errors.js";
import { chooseRenderScale } from "../src/pdf/renderer.js";
import { resolveDocumentInit, sourceKey } from "../src/pdf/source.js";
import { cdnWorkerSrc, configureWorker, loadPdfjs } from "../src/pdf/worker.js";
import { createFakePdfjs } from "./helpers/fakePdfjs.js";

const base = {
  baseWidth: 612,
  baseHeight: 792,
  cssWidth: 306,
  devicePixelRatio: 1,
  requested: "auto" as const,
  maxPixels: 12_000_000,
};

describe("chooseRenderScale", () => {
  it("matches the slot width at 1x and rounds up to a quarter step", () => {
    expect(chooseRenderScale(base)).toBe(0.5);
    expect(chooseRenderScale({ ...base, cssWidth: 320 })).toBe(0.75);
  });

  it("doubles for a 2x display", () => {
    expect(chooseRenderScale({ ...base, devicePixelRatio: 2 })).toBe(1);
  });

  it("uses a fixed scale when asked", () => {
    expect(chooseRenderScale({ ...base, requested: 2 })).toBe(2);
  });

  it("never exceeds the canvas pixel budget", () => {
    const scale = chooseRenderScale({ ...base, cssWidth: 5000, maxPixels: 1_000_000 });
    expect(612 * 792 * scale * scale).toBeLessThanOrEqual(1_000_000 + 1);
  });

  it("falls back to scale 1 for nonsense input", () => {
    // Callers never ask before a width is known, but the maths must stay sane.
    expect(chooseRenderScale({ ...base, cssWidth: 0 })).toBe(1);
    expect(chooseRenderScale({ ...base, requested: Number.NaN })).toBe(1);
  });
});

describe("mapPdfError", () => {
  const named = (name: string, extra: object = {}) => Object.assign(new Error(name), { name, ...extra });

  it("recognises PDF.js exceptions", () => {
    expect(mapPdfError(named("InvalidPDFException")).code).toBe("INVALID_PDF");
    expect(mapPdfError(named("PasswordException")).code).toBe("PASSWORD_REQUIRED");
    expect(mapPdfError(named("ResponseException", { status: 404, missing: true })).code).toBe("PDF_NOT_FOUND");
    expect(mapPdfError(named("ResponseException", { status: 500 })).code).toBe("NETWORK_ERROR");
  });

  it("explains network and CORS failures", () => {
    const error = mapPdfError(new TypeError("Failed to fetch"));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toMatch(/CORS/);
  });

  it("flags worker failures with a hint", () => {
    const error = mapPdfError(new Error("Setting up fake worker failed: boom"));
    expect(error.code).toBe("PDF_WORKER_FAILED");
    expect(error.message).toMatch(/workerSrc/);
  });

  it("keeps the cause and uses the fallback code otherwise", () => {
    const cause = new Error("odd");
    const error = mapPdfError(cause, "PAGE_RENDER_FAILED");
    expect(error.code).toBe("PAGE_RENDER_FAILED");
    expect(error.cause).toBe(cause);
  });

  it("passes our own errors through", () => {
    const own = new FlipBookRuntimeError("UNSUPPORTED_SOURCE", "nope");
    expect(mapPdfError(own)).toBe(own);
  });

  it("treats cancellations as cancellations", () => {
    expect(isCancellation(new CancelledError())).toBe(true);
    expect(isCancellation(named("RenderingCancelledException"))).toBe(true);
    expect(isCancellation(named("AbortException"))).toBe(true);
    expect(isCancellation(new Error("real failure"))).toBe(false);
  });
});

describe("sources", () => {
  it("identifies URLs by value and binary data by reference", () => {
    expect(sourceKey("/a.pdf")).toBe(sourceKey("/a.pdf"));
    expect(sourceKey("/a.pdf")).not.toBe(sourceKey("/b.pdf"));
    expect(sourceKey(new URL("https://x.test/a.pdf"))).toBe(sourceKey("https://x.test/a.pdf"));
    const bytes = new Uint8Array([1, 2, 3]);
    expect(sourceKey(bytes)).toBe(sourceKey(bytes));
    expect(sourceKey(bytes)).not.toBe(sourceKey(new Uint8Array([1, 2, 3])));
  });

  it("passes URLs and request options through", async () => {
    const init = await resolveDocumentInit("/a.pdf", {
      password: "pw",
      withCredentials: true,
      httpHeaders: { Authorization: "x" },
    });
    expect(init).toEqual({
      url: "/a.pdf",
      password: "pw",
      withCredentials: true,
      httpHeaders: { Authorization: "x" },
    });
  });

  it("forwards extra getDocument parameters, with the source taking precedence", async () => {
    const init = await resolveDocumentInit("/a.pdf", {
      documentParams: { standardFontDataUrl: "/fonts/", cMapUrl: "/cmaps/", url: "/ignored.pdf" },
      password: "pw",
    });
    expect(init).toEqual({ standardFontDataUrl: "/fonts/", cMapUrl: "/cmaps/", url: "/a.pdf", password: "pw" });
  });

  it("reads Blobs without creating object URLs", async () => {
    const init = await resolveDocumentInit(new Blob([new Uint8Array([9, 8, 7])]), {});
    expect(Array.from(init.data ?? [])).toEqual([9, 8, 7]);
    expect(init.url).toBeUndefined();
  });

  it("copies ArrayBuffers so the caller's buffer is not detached", async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const init = await resolveDocumentInit(buffer, {});
    expect(init.data?.buffer).not.toBe(buffer);
    expect(buffer.byteLength).toBe(4);
    expect(Array.from(init.data ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("copies the visible window of a Uint8Array view", async () => {
    const whole = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const init = await resolveDocumentInit(whole.subarray(2, 5), {});
    expect(Array.from(init.data ?? [])).toEqual([2, 3, 4]);
  });

  it("rejects unsupported sources", async () => {
    await expect(resolveDocumentInit(42 as never, {})).rejects.toMatchObject({
      code: "UNSUPPORTED_SOURCE",
    });
  });
});

describe("worker setup", () => {
  it("uses an explicit workerSrc", async () => {
    const fake = createFakePdfjs();
    await loadPdfjs({ loadPdfjs: fake.loadPdfjs, workerSrc: "/pdf.worker.min.mjs" });
    expect(fake.pdfjs.GlobalWorkerOptions.workerSrc).toBe("/pdf.worker.min.mjs");
  });

  it("falls back to the CDN at the installed version when nothing is configured", async () => {
    const fake = createFakePdfjs();
    await loadPdfjs({ loadPdfjs: fake.loadPdfjs });
    expect(fake.pdfjs.GlobalWorkerOptions.workerSrc).toBe(cdnWorkerSrc("0.0.0-test"));
    expect(cdnWorkerSrc("1.2.3")).toBe("https://cdn.jsdelivr.net/npm/pdfjs-dist@1.2.3/build/pdf.worker.min.mjs");
  });

  it("keeps a worker the app configured itself", async () => {
    const fake = createFakePdfjs();
    fake.pdfjs.GlobalWorkerOptions.workerSrc = "/mine.mjs";
    await loadPdfjs({ loadPdfjs: fake.loadPdfjs });
    expect(fake.pdfjs.GlobalWorkerOptions.workerSrc).toBe("/mine.mjs");
  });

  it("lets an explicit option override an existing setting", () => {
    const fake = createFakePdfjs();
    fake.pdfjs.GlobalWorkerOptions.workerSrc = "/old.mjs";
    configureWorker(fake.pdfjs, "/new.mjs");
    expect(fake.pdfjs.GlobalWorkerOptions.workerSrc).toBe("/new.mjs");
  });

  it("loads the module once per loader", async () => {
    let calls = 0;
    const fake = createFakePdfjs();
    const loader = () => {
      calls += 1;
      return Promise.resolve(fake.pdfjs);
    };
    await Promise.all([loadPdfjs({ loadPdfjs: loader }), loadPdfjs({ loadPdfjs: loader })]);
    expect(calls).toBe(1);
  });

  it("retries after a failed load", async () => {
    let attempts = 0;
    const fake = createFakePdfjs();
    const loader = () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("chunk failed")) : Promise.resolve(fake.pdfjs);
    };
    await expect(loadPdfjs({ loadPdfjs: loader })).rejects.toThrow("chunk failed");
    await expect(loadPdfjs({ loadPdfjs: loader })).resolves.toBe(fake.pdfjs);
  });

  it("accepts a module with a default export and rejects anything else", async () => {
    const fake = createFakePdfjs();
    await expect(loadPdfjs({ loadPdfjs: () => Promise.resolve({ default: fake.pdfjs }) })).resolves.toBe(fake.pdfjs);
    await expect(loadPdfjs({ loadPdfjs: () => Promise.resolve({ nope: true }) })).rejects.toMatchObject({
      code: "PDF_LOAD_FAILED",
    });
  });
});
