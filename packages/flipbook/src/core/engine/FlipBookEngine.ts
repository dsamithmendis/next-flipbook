import { createBrowserScheduler, type Scheduler } from "../animation/scheduler.js";
import { clamp01, easeOutCubic, springEase } from "../animation/easing.js";
import { tween, type TweenHandle } from "../animation/tween.js";
import {
  getSpread,
  pageToSpreadIndex,
  spreadCount,
  spreadFirstPage,
  spreadPages,
  type LayoutOptions,
  type Spread,
} from "../layout/spreads.js";
import type {
  EngineConfig,
  EngineConfigPatch,
  EngineEventMap,
  EngineOptions,
  EngineState,
  FlipBookNavigation,
  TurnState,
} from "../types.js";

type Listener = () => void;
type FrameListener = (progress: number) => void;
type Handlers = { [K in keyof EngineEventMap]: Set<(payload: EngineEventMap[K]) => void> };

/**
 * Framework-agnostic flipbook state machine.
 *
 * The engine knows nothing about React, the DOM or page content. It tracks
 * which spread is showing, runs page-turn animations, and reports changes
 * through two channels:
 *
 * - `subscribe` fires on coarse changes (page changed, turn started or ended)
 *   and pairs with `getState`, so it works with `useSyncExternalStore`.
 * - `subscribeFrame` fires once per animation frame with turn progress, so a
 *   renderer can update the DOM directly without re-rendering.
 *
 * State moves `idle -> turning -> idle` for scripted turns. The logical
 * position (and `currentPage`) commits when a turn starts, so `next()`
 * reports the destination immediately while the animation plays.
 *
 * A reader can also hold a page: `idle -> dragging -> settling -> idle`.
 * `beginDrag` lifts the page, `dragTo` follows the pointer, and `endDrag`
 * either finishes the turn or springs the page back. A turn that is
 * completed commits when the page is released; a cancelled one never moves
 * the reader.
 */
export class FlipBookEngine implements FlipBookNavigation {
  private config: EngineConfig;
  private readonly scheduler: Scheduler;
  private initialPage: number;
  private spreadIndex: number;
  private turn: TurnState | null = null;
  private progress = 0;
  private dragging = false;
  private settling = false;
  private pending: number | null = null;
  private handle: TweenHandle | null = null;
  private destroyed = false;
  private snapshot: EngineState;
  private readonly listeners = new Set<Listener>();
  private readonly frameListeners = new Set<FrameListener>();
  private readonly handlers: Handlers = {
    pagechange: new Set(),
    turnstart: new Set(),
    turnend: new Set(),
  };

  constructor(options: EngineOptions) {
    this.config = {
      pageCount: Math.max(0, Math.floor(options.pageCount)),
      view: options.view ?? "double",
      cover: options.cover ?? false,
      direction: options.direction ?? "ltr",
      duration: options.duration ?? 700,
      reducedMotion: options.reducedMotion ?? false,
      whileTurning: options.whileTurning ?? "queue",
    };
    this.scheduler = options.scheduler ?? createBrowserScheduler();
    this.initialPage = options.initialPage ?? 1;
    this.spreadIndex =
      this.config.pageCount === 0 ? 0 : pageToSpreadIndex(this.initialPage, this.layout());
    this.snapshot = this.buildSnapshot();
  }

  // ---- reading state -------------------------------------------------------

  /** Stable between changes, so it is safe as a `useSyncExternalStore` snapshot. */
  readonly getState = (): EngineState => this.snapshot;

  /** Progress (0..1, eased) of the running turn, or 0 when idle. */
  getTurnProgress(): number {
    return this.progress;
  }

  /** The spread at `index`, using the current layout. */
  getSpreadAt(index: number): Spread {
    return getSpread(index, this.layout());
  }

  getCurrentPage(): number {
    return this.snapshot.currentPage;
  }

  getPageCount(): number {
    return this.config.pageCount;
  }

  isAnimating(): boolean {
    return this.turn !== null;
  }

  // ---- subscriptions -------------------------------------------------------

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly subscribeFrame = (listener: FrameListener): (() => void) => {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  };

  readonly on = <E extends keyof EngineEventMap>(
    event: E,
    handler: (payload: EngineEventMap[E]) => void,
  ): (() => void) => {
    const set = this.handlers[event];
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  };

  // ---- navigation ----------------------------------------------------------

  next(): void {
    this.goToSpread((this.pending ?? this.spreadIndex) + 1);
  }

  previous(): void {
    this.goToSpread((this.pending ?? this.spreadIndex) - 1);
  }

  first(): void {
    this.goToSpread(0);
  }

  last(): void {
    this.goToSpread(this.snapshot.spreadCount - 1);
  }

  goToPage(page: number): void {
    if (!Number.isFinite(page)) return;
    this.goToSpread(pageToSpreadIndex(page, this.layout()));
  }

  /**
   * Moves to the spread containing `page` at once, with no page-turn
   * animation. For restoring a saved or linked position. Ends any running
   * turn first and reports the change like any other. A book that has no
   * pages yet (a PDF still loading) opens at `page` when they arrive.
   */
  jumpToPage(page: number): void {
    if (this.destroyed || !Number.isFinite(page)) return;
    if (this.snapshot.spreadCount === 0) {
      this.initialPage = Math.max(1, Math.floor(page));
      return;
    }
    const target = pageToSpreadIndex(page, this.layout());
    const wasTurning = this.turn !== null;
    const previousPage = this.snapshot.currentPage;
    if (target === this.spreadIndex && !wasTurning) return;
    this.settle();
    this.spreadIndex = target;
    this.snapshot = this.buildSnapshot();
    this.notify();
    if (wasTurning) this.emit("turnend", { page: this.snapshot.currentPage });
    if (this.snapshot.currentPage !== previousPage) {
      this.emit("pagechange", { page: this.snapshot.currentPage });
    }
  }

  // ---- dragging --------------------------------------------------------------

  /**
   * Lifts the page at the edge of the current spread so a pointer can turn
   * it. Returns false when there is nothing to turn to or a turn is running.
   */
  beginDrag(direction: "forward" | "backward"): boolean {
    if (this.destroyed || this.turn !== null) return false;
    const target = this.spreadIndex + (direction === "forward" ? 1 : -1);
    if (target < 0 || target >= this.snapshot.spreadCount) return false;

    const fromPage = this.snapshot.currentPage;
    this.turn = { from: this.spreadIndex, to: target, forward: direction === "forward" };
    this.progress = 0;
    this.dragging = true;
    this.snapshot = this.buildSnapshot();
    this.notify();
    this.emit("turnstart", {
      fromPage,
      toPage: spreadFirstPage(getSpread(target, this.layout())),
    });
    return true;
  }

  /** Moves the held page. 0 is where the turn began and 1 is fully turned. */
  dragTo(progress: number): void {
    if (!this.dragging || this.turn === null) return;
    this.onFrame(clamp01(progress));
  }

  /**
   * Lets go of the page. `complete` finishes the turn; otherwise the page
   * springs back and the reader stays where they were.
   */
  endDrag(options: { complete: boolean }): void {
    if (!this.dragging || this.turn === null) return;
    const turn = this.turn;
    const start = this.progress;
    const target = options.complete ? 1 : 0;
    const distance = Math.abs(target - start);

    this.dragging = false;
    this.settling = true;
    if (options.complete) this.spreadIndex = turn.to;
    this.snapshot = this.buildSnapshot();
    this.notify();
    if (options.complete) this.emit("pagechange", { page: this.snapshot.currentPage });

    const duration = this.config.reducedMotion
      ? 0
      : Math.max(90, this.config.duration * (options.complete ? 0.5 : 0.4) * distance);
    if (duration <= 0 || distance === 0) {
      this.onFrame(target);
      this.endTurn();
      return;
    }
    this.handle = tween(this.scheduler, {
      duration,
      easing: options.complete ? easeOutCubic : springEase,
      onUpdate: (eased) => this.onFrame(start + (target - start) * eased),
      onComplete: () => this.endTurn(),
    });
  }

  // ---- configuration & lifecycle ------------------------------------------

  /**
   * Applies new settings. A change to the page count, view, cover or
   * direction ends any running turn and keeps the reader on the same page.
   */
  configure(patch: EngineConfigPatch): void {
    if (this.destroyed) return;
    const previous = this.config;
    const next: EngineConfig = {
      pageCount:
        patch.pageCount !== undefined
          ? Math.max(0, Math.floor(patch.pageCount))
          : previous.pageCount,
      view: patch.view ?? previous.view,
      cover: patch.cover ?? previous.cover,
      direction: patch.direction ?? previous.direction,
      duration: patch.duration ?? previous.duration,
      reducedMotion: patch.reducedMotion ?? previous.reducedMotion,
      whileTurning: patch.whileTurning ?? previous.whileTurning,
    };

    const layoutChanged =
      next.pageCount !== previous.pageCount ||
      next.view !== previous.view ||
      next.cover !== previous.cover;
    const visualChanged = layoutChanged || next.direction !== previous.direction;

    const previousPage = this.snapshot.currentPage;
    const wasTurning = this.turn !== null;
    if (visualChanged) this.settle();
    this.config = next;
    if (!visualChanged) return;

    if (layoutChanged) {
      // A book that started empty (a PDF still loading) honours `initialPage`
      // once its pages arrive.
      this.spreadIndex =
        next.pageCount === 0
          ? 0
          : pageToSpreadIndex(previousPage || this.initialPage, this.layout());
    }
    this.snapshot = this.buildSnapshot();
    this.notify();
    if (wasTurning) this.emit("turnend", { page: this.snapshot.currentPage });
    // Going from "no pages" to "some pages" is loading, not navigation.
    if (previousPage !== 0 && this.snapshot.currentPage !== previousPage) {
      this.emit("pagechange", { page: this.snapshot.currentPage });
    }
  }

  /**
   * Cancels the running animation and any queued navigation, keeping the
   * reader on the destination page. Safe to call repeatedly.
   */
  stop(): void {
    if (this.destroyed) return;
    if (this.turn === null && this.pending === null) return;
    const wasTurning = this.turn !== null;
    this.settle();
    this.snapshot = this.buildSnapshot();
    this.notify();
    if (wasTurning) this.emit("turnend", { page: this.snapshot.currentPage });
  }

  /** Stops all work and drops every listener. The engine cannot be reused. */
  destroy(): void {
    if (this.destroyed) return;
    this.settle();
    this.destroyed = true;
    this.listeners.clear();
    this.frameListeners.clear();
    for (const set of Object.values(this.handlers)) set.clear();
  }

  // ---- internals -----------------------------------------------------------

  private layout(): LayoutOptions {
    return {
      pageCount: this.config.pageCount,
      view: this.config.view,
      cover: this.config.cover,
    };
  }

  private goToSpread(index: number): void {
    if (this.destroyed) return;
    const total = this.snapshot.spreadCount;
    if (total === 0) return;
    const target = Math.min(total - 1, Math.max(0, Math.round(index)));

    if (this.turn !== null) {
      if (this.config.whileTurning === "ignore") return;
      this.pending = target === this.spreadIndex ? null : target;
      return;
    }
    if (target !== this.spreadIndex) this.beginTurn(target);
  }

  private beginTurn(target: number): void {
    const from = this.spreadIndex;
    const distance = Math.abs(target - from);
    const duration = this.config.reducedMotion
      ? 0
      : this.config.duration + Math.min(distance - 1, 8) * 60;
    const fromPage = this.snapshot.currentPage;

    this.spreadIndex = target;

    if (duration <= 0) {
      this.snapshot = this.buildSnapshot();
      this.notify();
      const page = this.snapshot.currentPage;
      this.emit("turnstart", { fromPage, toPage: page });
      this.emit("pagechange", { page });
      this.emit("turnend", { page });
      return;
    }

    this.turn = { from, to: target, forward: target > from };
    this.progress = 0;
    this.snapshot = this.buildSnapshot();
    this.notify();
    const page = this.snapshot.currentPage;
    this.emit("turnstart", { fromPage, toPage: page });
    this.emit("pagechange", { page });

    this.handle = tween(this.scheduler, {
      duration,
      onUpdate: (progress) => this.onFrame(progress),
      onComplete: () => this.endTurn(),
    });
  }

  private onFrame(progress: number): void {
    if (this.turn === null) return;
    this.progress = progress;
    for (const listener of [...this.frameListeners]) listener(progress);
  }

  private endTurn(): void {
    this.handle = null;
    this.turn = null;
    this.progress = 0;
    this.dragging = false;
    this.settling = false;
    this.snapshot = this.buildSnapshot();
    this.notify();
    this.emit("turnend", { page: this.snapshot.currentPage });

    const pending = this.pending;
    this.pending = null;
    if (pending !== null && pending !== this.spreadIndex) this.beginTurn(pending);
  }

  /** Drops running and queued work without notifying anyone. */
  private settle(): void {
    this.handle?.cancel();
    this.handle = null;
    this.turn = null;
    this.progress = 0;
    this.pending = null;
    this.dragging = false;
    this.settling = false;
  }

  private buildSnapshot(): EngineState {
    const total = spreadCount(this.layout());
    const spread = getSpread(this.spreadIndex, this.layout());
    return {
      pageCount: this.config.pageCount,
      view: this.config.view,
      cover: this.config.cover,
      direction: this.config.direction,
      spreadIndex: this.spreadIndex,
      spreadCount: total,
      spread,
      currentPage: spreadFirstPage(spread),
      visiblePages: spreadPages(spread),
      status:
        this.turn === null
          ? "idle"
          : this.dragging
            ? "dragging"
            : this.settling
              ? "settling"
              : "turning",
      turn: this.turn,
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private emit<E extends keyof EngineEventMap>(event: E, payload: EngineEventMap[E]): void {
    for (const handler of [...this.handlers[event]]) {
      try {
        handler(payload);
      } catch (error) {
        // A throwing consumer callback must not corrupt engine state.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
