import { FlipBookRuntimeError } from "../core/errors.js";
import type { PdfPageProxy } from "./types.js";

/** A page drawn to a canvas, ready to be placed in the DOM. */
export interface RenderedPage {
  readonly canvas: HTMLCanvasElement;
  /** Canvas size in device pixels. */
  readonly width: number;
  readonly height: number;
  /** Pixels per PDF point. */
  readonly scale: number;
  /** Approximate memory, for the cache budget. */
  readonly bytes: number;
}

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === "undefined") {
    throw new FlipBookRuntimeError(
      "UNSUPPORTED_ENVIRONMENT",
      "PDF pages can only be rendered in a browser.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export interface ScaleInput {
  /** Page size in PDF points at scale 1. */
  baseWidth: number;
  baseHeight: number;
  /** On-screen width of the page slot, in CSS pixels. */
  cssWidth: number;
  devicePixelRatio: number;
  requested: "auto" | number;
  maxPixels: number;
}

/**
 * Picks a render scale. `auto` matches the slot width times the device pixel
 * ratio, rounded up to a quarter step so small resizes reuse the cached
 * render, then capped so one canvas never exceeds `maxPixels`.
 */
export function chooseRenderScale(input: ScaleInput): number {
  const { baseWidth, baseHeight, cssWidth, devicePixelRatio, requested, maxPixels } = input;
  const area = Math.max(1, baseWidth * baseHeight);
  const maxScale = Math.sqrt(maxPixels / area);

  let wanted = requested === "auto" ? (cssWidth * devicePixelRatio) / Math.max(1, baseWidth) : requested;
  if (!Number.isFinite(wanted) || wanted <= 0) wanted = 1;

  const stepped = Math.max(0.25, Math.ceil(wanted * 4) / 4);
  return Math.min(stepped, maxScale);
}

/**
 * Renders one page. Aborting the signal cancels the PDF.js task, and a
 * failed or cancelled render releases its canvas immediately.
 */
export async function renderPdfPage(
  page: PdfPageProxy,
  scale: number,
  options: { createCanvas: CanvasFactory; signal?: AbortSignal },
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));

  const canvas = options.createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new FlipBookRuntimeError("PAGE_RENDER_FAILED", "Could not create a 2D canvas context.");
  }

  const task = page.render({ canvas, canvasContext: context, viewport });
  const cancel = (): void => task.cancel();
  const { signal } = options;
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });

  try {
    await task.promise;
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }

  return { canvas, width, height, scale, bytes: width * height * 4 };
}
