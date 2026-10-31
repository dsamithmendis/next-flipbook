export type PanelId = "thumbnails" | "bookmarks" | "search" | "outline";

/** `native` is the browser's Fullscreen API; `fixed` is the fallback that fills the viewport. */
export type FullscreenMode = "none" | "native" | "fixed";

export interface UiNotice {
  /** Changes with every notice, so the same text can be announced again. */
  readonly id: number;
  readonly text: string;
}

export interface UiSnapshot {
  readonly panel: PanelId | null;
  readonly notice: UiNotice | null;
  /** Progress of a print job being prepared, or null. */
  readonly printing: { readonly done: number; readonly total: number } | null;
  readonly fullscreen: FullscreenMode;
  /** Id of the hotspot whose popover is open. */
  readonly hotspot: string | null;
}

export interface UiDeps {
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** How long a notice stays. Default 2800 ms. */
  noticeMs?: number;
}

/**
 * Small state shared by the toolbar, the side panel and the controller: which
 * panel is open, the current notice, print progress and fullscreen mode. It
 * lives outside React so `ref.current.openPanel("thumbnails")` works from
 * anywhere.
 */
export class UiStore {
  private snapshot: UiSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly noticeMs: number;
  private timer: unknown = null;
  private noticeId = 0;

  constructor(initial: Partial<Pick<UiSnapshot, "panel">> = {}, deps: UiDeps = {}) {
    this.snapshot = { panel: initial.panel ?? null, notice: null, printing: null, fullscreen: "none", hotspot: null };
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as number));
    this.noticeMs = deps.noticeMs ?? 2800;
  }

  readonly getSnapshot = (): UiSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setPanel(panel: PanelId | null): void {
    this.set({ panel });
  }

  togglePanel(panel: PanelId): void {
    this.set({ panel: this.snapshot.panel === panel ? null : panel });
  }

  /** Shows a message. `ms` of 0 keeps it until `clearNotice()` or the next notice. */
  notify(text: string, ms: number = this.noticeMs): void {
    this.cancelTimer();
    this.noticeId += 1;
    this.set({ notice: { id: this.noticeId, text } });
    if (ms > 0) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.set({ notice: null });
      }, ms);
    }
  }

  clearNotice(): void {
    this.cancelTimer();
    this.set({ notice: null });
  }

  setPrinting(progress: { done: number; total: number } | null): void {
    this.set({ printing: progress });
  }

  setHotspot(id: string | null): void {
    this.set({ hotspot: id });
  }

  setFullscreen(mode: FullscreenMode): void {
    this.set({ fullscreen: mode });
  }

  /** Cancels the notice timer. The store can be used again afterwards. */
  stop(): void {
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private set(patch: Partial<UiSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    const current = this.snapshot;
    if (
      next.panel === current.panel &&
      next.notice === current.notice &&
      next.fullscreen === current.fullscreen &&
      next.hotspot === current.hotspot &&
      samePrinting(next.printing, current.printing)
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

function samePrinting(a: UiSnapshot["printing"], b: UiSnapshot["printing"]): boolean {
  if (a === b) return true;
  return a !== null && b !== null && a.done === b.done && a.total === b.total;
}
