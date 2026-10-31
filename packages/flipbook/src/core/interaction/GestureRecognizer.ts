import type { FlipBookDirection } from "../types.js";

export type PointerKind = "mouse" | "touch" | "pen";

export interface Point {
  x: number;
  y: number;
}

/** A pointer event reduced to what recognition needs. `time` is in milliseconds. */
export interface PointerInput extends Point {
  id: number;
  kind: PointerKind;
  time: number;
  /** Mouse button. Only the primary button (0) starts a gesture. */
  button?: number;
}

export interface GestureHandlers {
  direction(): FlipBookDirection;
  /** Drag-to-turn is on, the book is not zoomed, and there are pages. */
  canTurn(): boolean;
  canZoom(): boolean;
  isZoomed(): boolean;
  /** Return false when there is no page to turn to; the gesture is then ignored. */
  onTurnStart(direction: "forward" | "backward"): boolean;
  /** `pull` is how far the pointer has moved in the direction of the turn. */
  onTurnMove(info: { pull: number; forward: boolean }): void;
  /** `velocity` is px/ms in the direction of the turn; negative means it was moving back. */
  onTurnEnd(info: { pull: number; velocity: number; forward: boolean; cancelled: boolean }): void;
  onPan(dx: number, dy: number): void;
  onPinchStart(center: Point): void;
  /** `scale` is the current finger distance over the distance when the pinch began. */
  onPinch(info: { scale: number; center: Point }): void;
  onPinchEnd(): void;
  onDoubleTap(point: Point): void;
}

export interface GestureConfig {
  /** Movement, in pixels, before a press becomes a drag. */
  mouseSlop?: number;
  touchSlop?: number;
  /** A drag is horizontal when |dx| is at least this many times |dy|. */
  horizontalBias?: number;
  doubleTapMs?: number;
  doubleTapDistance?: number;
  /** Longest press that still counts as a tap. */
  tapMs?: number;
  /** Window used to measure release velocity. */
  velocityWindowMs?: number;
}

type Mode = "idle" | "pending" | "turn" | "pan" | "pinch" | "ignored";

interface Tracked extends Point {
  id: number;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Turns raw pointer events into intents: turn a page, pan, pinch, double-tap.
 *
 * It owns no DOM and no timers, so the same logic serves mouse, touch and pen
 * and can be tested by feeding it events. One finger either turns a page
 * (when the book is at its fitted size) or pans (when zoomed); a second
 * finger always means pinch and cancels a turn in progress, so panning or
 * pinching can never turn a page by accident.
 */
export class GestureRecognizer {
  private readonly handlers: GestureHandlers;
  private readonly config: Required<GestureConfig>;
  private readonly pointers = new Map<number, Tracked>();
  private mode: Mode = "idle";
  private origin: PointerInput | null = null;
  private last: Point = { x: 0, y: 0 };
  private trace: Array<{ x: number; time: number }> = [];
  private turnForward = false;
  private turnX = 0;
  private pinchStartDistance = 1;
  private lastTap: { x: number; y: number; time: number } | null = null;
  private moved = false;

  constructor(handlers: GestureHandlers, config: GestureConfig = {}) {
    this.handlers = handlers;
    this.config = {
      mouseSlop: config.mouseSlop ?? 4,
      touchSlop: config.touchSlop ?? 8,
      horizontalBias: config.horizontalBias ?? 1.2,
      doubleTapMs: config.doubleTapMs ?? 300,
      doubleTapDistance: config.doubleTapDistance ?? 32,
      tapMs: config.tapMs ?? 400,
      velocityWindowMs: config.velocityWindowMs ?? 100,
    };
  }

  /** True once the current gesture moved far enough to be a drag, pan or pinch. Use it to swallow the click that follows. */
  get dragged(): boolean {
    return this.moved;
  }

  get active(): boolean {
    return this.pointers.size > 0;
  }

  pointerDown(input: PointerInput): void {
    if (input.kind === "mouse" && (input.button ?? 0) !== 0) return;
    this.pointers.set(input.id, { id: input.id, x: input.x, y: input.y });

    if (this.pointers.size === 1) {
      this.mode = "pending";
      this.origin = input;
      this.last = { x: input.x, y: input.y };
      this.trace = [{ x: input.x, time: input.time }];
      this.moved = false;
      return;
    }

    if (this.pointers.size === 2) {
      this.lastTap = null;
      if (this.mode === "turn") this.finishTurn(this.turnX, input.time, true);
      if (this.handlers.canZoom()) {
        const [a, b] = this.firstTwo();
        this.mode = "pinch";
        this.moved = true;
        this.pinchStartDistance = Math.max(1, distance(a, b));
        this.handlers.onPinchStart(midpoint(a, b));
      } else {
        this.mode = "ignored";
      }
    }
  }

  pointerMove(input: PointerInput): void {
    const tracked = this.pointers.get(input.id);
    if (!tracked) return;
    tracked.x = input.x;
    tracked.y = input.y;

    switch (this.mode) {
      case "pending":
        this.decide(input);
        return;
      case "turn":
        this.moveTurn(input);
        return;
      case "pan":
        this.handlers.onPan(input.x - this.last.x, input.y - this.last.y);
        this.last = { x: input.x, y: input.y };
        return;
      case "pinch": {
        const [a, b] = this.firstTwo();
        this.handlers.onPinch({
          scale: distance(a, b) / this.pinchStartDistance,
          center: midpoint(a, b),
        });
        return;
      }
      default:
        return;
    }
  }

  pointerUp(input: PointerInput): void {
    const tracked = this.pointers.get(input.id);
    if (!tracked) return;
    tracked.x = input.x;
    tracked.y = input.y;

    const mode = this.mode;
    if (mode === "pending") this.registerTap(input);
    else if (mode === "turn") this.finishTurn(input.x, input.time, false);
    else if (mode === "pinch") this.handlers.onPinchEnd();

    this.pointers.delete(input.id);
    this.afterRelease(mode);
  }

  /** The browser took the pointer over (for example a vertical scroll). */
  pointerCancel(input: PointerInput): void {
    if (!this.pointers.has(input.id)) return;
    const mode = this.mode;
    if (mode === "turn") this.finishTurn(this.turnX, input.time, true);
    else if (mode === "pinch") this.handlers.onPinchEnd();
    this.pointers.delete(input.id);
    this.afterRelease(mode);
  }

  /** Ends everything without callbacks beyond cancelling a turn. For unmount and blur. */
  reset(): void {
    if (this.mode === "turn" && this.origin) {
      this.finishTurn(this.turnX, this.origin.time, true);
    } else if (this.mode === "pinch") {
      this.handlers.onPinchEnd();
    }
    this.pointers.clear();
    this.mode = "idle";
    this.origin = null;
    this.lastTap = null;
  }

  // ---- internals -----------------------------------------------------------

  private afterRelease(previous: Mode): void {
    if (this.pointers.size === 0) {
      this.mode = "idle";
      this.origin = null;
    } else if (previous === "pinch" || previous === "turn") {
      // A finger lifted mid-gesture: the rest of the touch is not a new gesture.
      this.mode = "ignored";
    }
  }

  private firstTwo(): [Tracked, Tracked] {
    const [a, b] = [...this.pointers.values()];
    return [a as Tracked, b as Tracked];
  }

  private decide(input: PointerInput): void {
    const origin = this.origin;
    if (!origin) return;
    const dx = input.x - origin.x;
    const dy = input.y - origin.y;
    const slop = input.kind === "mouse" ? this.config.mouseSlop : this.config.touchSlop;
    if (Math.hypot(dx, dy) < slop) return;

    this.moved = true;
    this.lastTap = null;

    if (this.handlers.canZoom() && this.handlers.isZoomed()) {
      this.mode = "pan";
      this.handlers.onPan(input.x - this.last.x, input.y - this.last.y);
      this.last = { x: input.x, y: input.y };
      return;
    }

    if (this.handlers.canTurn() && Math.abs(dx) >= Math.abs(dy) * this.config.horizontalBias) {
      const forward = dx < 0 === (this.handlers.direction() === "ltr");
      if (this.handlers.onTurnStart(forward ? "forward" : "backward")) {
        this.mode = "turn";
        this.turnForward = forward;
        this.moveTurn(input);
        return;
      }
    }
    this.mode = "ignored";
  }

  /** +1 when moving right pulls the page along, -1 when moving left does. */
  private pullSign(): 1 | -1 {
    return this.turnForward === (this.handlers.direction() === "ltr") ? -1 : 1;
  }

  private pull(x: number): number {
    return this.pullSign() * (x - (this.origin?.x ?? x));
  }

  private pushSample(x: number, time: number): void {
    this.trace.push({ x, time });
    const cutoff = time - this.config.velocityWindowMs;
    while (this.trace.length > 2 && (this.trace[0] as { time: number }).time < cutoff) {
      this.trace.shift();
    }
  }

  private moveTurn(input: PointerInput): void {
    this.turnX = input.x;
    this.pushSample(input.x, input.time);
    this.handlers.onTurnMove({ pull: this.pull(input.x), forward: this.turnForward });
  }

  private finishTurn(x: number, time: number, cancelled: boolean): void {
    // Sampling the release itself means a pause before letting go reads as zero speed.
    this.pushSample(x, time);
    const first = this.trace[0];
    const last = this.trace[this.trace.length - 1];
    let velocity = 0;
    if (first && last && last.time > first.time) {
      // `+ 0` turns -0 into 0 so a standstill compares equal to zero.
      velocity = (this.pullSign() * (last.x - first.x)) / (last.time - first.time) + 0;
    }
    this.handlers.onTurnEnd({
      pull: this.pull(x),
      velocity,
      forward: this.turnForward,
      cancelled,
    });
    this.mode = "ignored";
  }

  private registerTap(input: PointerInput): void {
    const origin = this.origin;
    if (!origin || input.time - origin.time > this.config.tapMs) {
      this.lastTap = null;
      return;
    }
    const previous = this.lastTap;
    if (
      previous &&
      input.time - previous.time <= this.config.doubleTapMs &&
      distance(previous, input) <= this.config.doubleTapDistance
    ) {
      this.lastTap = null;
      this.handlers.onDoubleTap({ x: input.x, y: input.y });
      return;
    }
    this.lastTap = { x: input.x, y: input.y, time: input.time };
  }
}
