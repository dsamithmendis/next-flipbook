import { easeInOutCubic } from "../animation/easing.js";
import { createBrowserScheduler, type Scheduler } from "../animation/scheduler.js";
import { tween, type TweenHandle } from "../animation/tween.js";
import type { Point } from "../interaction/GestureRecognizer.js";

export interface ZoomConfig {
  /** When false, every zoom and pan call does nothing. */
  enabled: boolean;
  minZoom: number;
  maxZoom: number;
  /** Step used by `zoomIn` and `zoomOut`. */
  zoomStep: number;
  /** Zoom a double-tap jumps to. */
  doubleTapZoom: number;
  /** When true, zoom changes are instant. */
  reducedMotion: boolean;
}

/** Sizes in CSS pixels. `contentWidth` and `contentHeight` are the book at zoom 1. */
export interface ZoomViewport {
  viewWidth: number;
  viewHeight: number;
  contentWidth: number;
  contentHeight: number;
  /** Space kept around the book at zoom 1; used by fit-width and fit-height. */
  padding: number;
}

/**
 * Live transform. Pan is in screen pixels, measured from the centre of the
 * view, and the book is scaled about its own centre.
 */
export interface ZoomTransform {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

/**
 * Coarse state for rendering. `zoom` is the value the zoom settled on, so a
 * pinch does not re-render React on every frame; `zoomed` flips the moment
 * the book is meaningfully larger than fitted.
 */
export interface ZoomSnapshot {
  readonly zoom: number;
  readonly zoomed: boolean;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
}

export interface ZoomDeps {
  scheduler?: Scheduler;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Quiet time after the last change before the zoom counts as settled. Default 160. */
  settleMs?: number;
}

/** Zoom above this counts as zoomed. Below it, drags turn pages. */
export const ZOOMED_ABOVE = 1.01;

const ANIMATION_MS = 220;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const round = (value: number, places = 3): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

const DEFAULTS: ZoomConfig = {
  enabled: true,
  minZoom: 1,
  maxZoom: 4,
  zoomStep: 0.25,
  doubleTapZoom: 2,
  reducedMotion: false,
};

/**
 * Zoom and pan state for the book, with no DOM and no React.
 *
 * Gestures (`pinchTo`, `panBy`, `zoomAround`) apply immediately. Buttons,
 * keys and double-tap go through `zoomTo`, which animates. Pan is always
 * clamped so the book cannot be dragged out of view, and a book smaller than
 * the view stays centred.
 */
export class ZoomController {
  private config: ZoomConfig;
  private readonly scheduler: Scheduler;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly settleMs: number;

  private viewport: ZoomViewport = {
    viewWidth: 0,
    viewHeight: 0,
    contentWidth: 0,
    contentHeight: 0,
    padding: 0,
  };
  private transform: ZoomTransform = { zoom: 1, panX: 0, panY: 0 };
  private settledZoom = 1;
  private snapshot: ZoomSnapshot;
  private animation: TweenHandle | null = null;
  private timer: unknown = null;
  private pinch: { start: ZoomTransform; center: Point } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly transformListeners = new Set<(transform: ZoomTransform) => void>();
  private readonly changeListeners = new Set<(zoom: number) => void>();
  private lastReported = 1;

  constructor(config: Partial<ZoomConfig> = {}, deps: ZoomDeps = {}) {
    this.config = { ...DEFAULTS, ...definedOnly(config) };
    this.scheduler = deps.scheduler ?? createBrowserScheduler();
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as number));
    this.settleMs = deps.settleMs ?? 160;
    this.snapshot = this.buildSnapshot();
  }

  // ---- reading state -------------------------------------------------------

  /** Stable between changes of the coarse state. Pairs with `useSyncExternalStore`. */
  readonly getSnapshot = (): ZoomSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Fires on every change of zoom or pan, including each pinch frame. Write it straight to the DOM. */
  readonly subscribeTransform = (listener: (transform: ZoomTransform) => void): (() => void) => {
    this.transformListeners.add(listener);
    return () => {
      this.transformListeners.delete(listener);
    };
  };

  /** Fires once per settled zoom change, with the final zoom. */
  readonly onChange = (listener: (zoom: number) => void): (() => void) => {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  };

  getTransform(): ZoomTransform {
    return this.transform;
  }

  getZoom(): number {
    return round(this.transform.zoom);
  }

  isZoomed(): boolean {
    return this.transform.zoom > ZOOMED_ABOVE;
  }

  // ---- configuration -------------------------------------------------------

  configure(patch: Partial<ZoomConfig>): void {
    this.config = { ...this.config, ...definedOnly(patch) };
    if (!this.config.enabled) {
      this.cancelAnimation();
      this.pinch = null;
      this.commit({ zoom: 1, panX: 0, panY: 0 });
    } else {
      this.commit(this.transform);
    }
    this.settle();
  }

  setViewport(viewport: ZoomViewport): void {
    this.viewport = viewport;
    this.commit(this.transform);
  }

  // ---- gestures: immediate ---------------------------------------------------

  /** Moves the book by a screen-space delta. Ignored unless zoomed in. */
  panBy(dx: number, dy: number): void {
    if (!this.config.enabled) return;
    this.cancelAnimation();
    this.commit({ ...this.transform, panX: this.transform.panX + dx, panY: this.transform.panY + dy });
  }

  /** Scales by `factor` while keeping the content under `focal` in place. */
  zoomAround(factor: number, focal: Point): void {
    if (!this.config.enabled) return;
    this.cancelAnimation();
    this.commit(this.zoomedAbout(this.transform.zoom * factor, focal));
  }

  /** Starts a pinch. `pinchTo` then works relative to this moment. */
  beginPinch(center: Point): void {
    if (!this.config.enabled) return;
    this.cancelAnimation();
    this.pinch = { start: this.transform, center };
  }

  /**
   * `scale` is the finger spread relative to the start of the pinch and
   * `center` is where the fingers are now, so a pinch also pans.
   */
  pinchTo(scale: number, center: Point): void {
    const pinch = this.pinch;
    if (!pinch || !this.config.enabled) return;
    const { start } = pinch;
    const zoom = clamp(start.zoom * scale, this.config.minZoom, this.config.maxZoom);
    // The content point that was under the fingers at the start stays under them.
    const contentX = (pinch.center.x - start.panX) / start.zoom;
    const contentY = (pinch.center.y - start.panY) / start.zoom;
    this.commit({ zoom, panX: center.x - zoom * contentX, panY: center.y - zoom * contentY });
  }

  endPinch(): void {
    if (!this.pinch) return;
    this.pinch = null;
    this.settle();
  }

  // ---- discrete: animated ----------------------------------------------------

  zoomTo(zoom: number, options: { focal?: Point; animate?: boolean } = {}): void {
    if (!this.config.enabled) return;
    const target = this.zoomedAbout(zoom, options.focal ?? { x: 0, y: 0 });
    this.goTo(target, options.animate ?? true);
  }

  zoomIn(focal?: Point): void {
    const { zoom } = this.transform;
    const step = this.config.zoomStep;
    this.zoomTo(round((Math.floor(zoom / step + 1e-6) + 1) * step), focal ? { focal } : {});
  }

  zoomOut(focal?: Point): void {
    const { zoom } = this.transform;
    const step = this.config.zoomStep;
    this.zoomTo(round((Math.ceil(zoom / step - 1e-6) - 1) * step), focal ? { focal } : {});
  }

  /** Fitted size, centred. */
  fit(): void {
    if (!this.config.enabled) return;
    this.goTo({ zoom: 1, panX: 0, panY: 0 }, true);
  }

  fitWidth(): void {
    const { viewWidth, contentWidth, padding } = this.viewport;
    if (contentWidth <= 0) return;
    this.zoomTo(((viewWidth - padding * 2) / contentWidth) || 1, {});
  }

  fitHeight(): void {
    const { viewHeight, contentHeight, padding } = this.viewport;
    if (contentHeight <= 0) return;
    this.zoomTo(((viewHeight - padding * 2) / contentHeight) || 1, {});
  }

  /** Double-tap: back to fitted if zoomed in, otherwise zoom in on the tapped point. */
  toggle(focal?: Point): void {
    if (!this.config.enabled) return;
    if (this.isZoomed()) this.fit();
    else this.zoomTo(this.config.doubleTapZoom, focal ? { focal } : {});
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Cancels animation and timers. The controller can be used again afterwards. */
  stop(): void {
    this.cancelAnimation();
    this.pinch = null;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  // ---- internals -----------------------------------------------------------

  private zoomedAbout(zoom: number, focal: Point): ZoomTransform {
    const current = this.transform;
    const next = clamp(zoom, this.config.minZoom, this.config.maxZoom);
    const ratio = next / current.zoom;
    return {
      zoom: next,
      panX: focal.x - ratio * (focal.x - current.panX),
      panY: focal.y - ratio * (focal.y - current.panY),
    };
  }

  private clampTransform(transform: ZoomTransform): ZoomTransform {
    const zoom = clamp(transform.zoom, this.config.minZoom, this.config.maxZoom);
    const { viewWidth, viewHeight, contentWidth, contentHeight } = this.viewport;
    const maxX = Math.max(0, (contentWidth * zoom - viewWidth) / 2);
    const maxY = Math.max(0, (contentHeight * zoom - viewHeight) / 2);
    return {
      zoom,
      panX: clamp(transform.panX, -maxX, maxX) + 0,
      panY: clamp(transform.panY, -maxY, maxY) + 0,
    };
  }

  private commit(next: ZoomTransform): void {
    const clamped = this.clampTransform(next);
    const current = this.transform;
    if (
      clamped.zoom === current.zoom &&
      clamped.panX === current.panX &&
      clamped.panY === current.panY
    ) {
      return;
    }
    this.transform = clamped;
    for (const listener of [...this.transformListeners]) listener(clamped);
    this.refreshSnapshot();
    this.scheduleSettle();
  }

  private goTo(target: ZoomTransform, animate: boolean): void {
    this.cancelAnimation();
    const from = this.transform;
    const to = this.clampTransform(target);
    if (!animate || this.config.reducedMotion) {
      this.commit(to);
      this.settle();
      return;
    }
    this.animation = tween(this.scheduler, {
      duration: ANIMATION_MS,
      easing: easeInOutCubic,
      onUpdate: (t) =>
        this.commit({
          zoom: from.zoom + (to.zoom - from.zoom) * t,
          panX: from.panX + (to.panX - from.panX) * t,
          panY: from.panY + (to.panY - from.panY) * t,
        }),
      onComplete: () => {
        this.animation = null;
        this.settle();
      },
    });
  }

  private cancelAnimation(): void {
    this.animation?.cancel();
    this.animation = null;
  }

  private scheduleSettle(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.settle();
    }, this.settleMs);
  }

  /** Marks the current zoom as final: updates the snapshot and reports the change. */
  private settle(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.settledZoom = round(this.transform.zoom);
    this.refreshSnapshot();
    if (this.settledZoom !== this.lastReported) {
      this.lastReported = this.settledZoom;
      for (const listener of [...this.changeListeners]) listener(this.settledZoom);
    }
  }

  private buildSnapshot(): ZoomSnapshot {
    const zoom = this.transform.zoom;
    return {
      zoom: this.settledZoom,
      zoomed: zoom > ZOOMED_ABOVE,
      minZoom: this.config.minZoom,
      maxZoom: this.config.maxZoom,
      canZoomIn: this.config.enabled && zoom < this.config.maxZoom - 1e-3,
      canZoomOut: this.config.enabled && zoom > this.config.minZoom + 1e-3,
    };
  }

  private refreshSnapshot(): void {
    const next = this.buildSnapshot();
    const current = this.snapshot;
    if (
      next.zoom === current.zoom &&
      next.zoomed === current.zoomed &&
      next.minZoom === current.minZoom &&
      next.maxZoom === current.maxZoom &&
      next.canZoomIn === current.canZoomIn &&
      next.canZoomOut === current.canZoomOut
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

function definedOnly<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}
