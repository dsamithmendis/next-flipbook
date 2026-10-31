import type { FullscreenMode } from "../core/ui/UiStore.js";

/** Browsers that still prefix the Fullscreen API (older Safari, iPadOS). */
interface FullscreenDocument {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenElement {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export interface FullscreenOptions {
  onChange?: (mode: FullscreenMode) => void;
  /**
   * When the Fullscreen API is missing or refused (iPhone Safari, an iframe
   * without `allow="fullscreen"`), fill the browser window instead. Default true.
   */
  fallback?: boolean;
}

/**
 * Fullscreen for one element. Uses the browser's Fullscreen API when it can
 * and otherwise stretches the element over the viewport, so the button still
 * does something useful everywhere. No browser global is read until a method
 * is called or an element is attached.
 */
export class FullscreenController {
  private element: (HTMLElement & FullscreenElement) | null = null;
  private mode: FullscreenMode = "none";
  private readonly onChange: ((mode: FullscreenMode) => void) | undefined;
  private readonly fallback: boolean;
  private savedOverflow: string | null = null;
  private listening = false;

  constructor(options: FullscreenOptions = {}) {
    this.onChange = options.onChange;
    this.fallback = options.fallback ?? true;
  }

  private readonly onDocumentChange = (): void => {
    const doc = this.doc();
    const active = doc?.fullscreenElement ?? doc?.webkitFullscreenElement ?? null;
    if (this.element !== null && active === this.element) this.setMode("native");
    else if (this.mode === "native") this.setMode("none");
  };

  /** The element to make fullscreen. Pass null to detach. */
  attach(element: HTMLElement | null): void {
    if (this.element === element) return;
    this.stopListening();
    if (this.mode !== "none") this.setMode("none");
    this.element = element;
    if (element) this.startListening();
  }

  getMode(): FullscreenMode {
    return this.mode;
  }

  isFullscreen(): boolean {
    return this.mode !== "none";
  }

  /** Whether the browser's own Fullscreen API can be used for the attached element. */
  isNativeAvailable(): boolean {
    const doc = this.doc();
    const element = this.element;
    if (!doc || !element) return false;
    const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false;
    return enabled && (element.requestFullscreen !== undefined || element.webkitRequestFullscreen !== undefined);
  }

  async enter(): Promise<void> {
    const element = this.element;
    if (!element || this.mode !== "none") return;

    if (this.isNativeAvailable()) {
      try {
        if (element.requestFullscreen) await element.requestFullscreen();
        else await element.webkitRequestFullscreen?.();
        this.onDocumentChange();
        if (this.mode !== "none") return;
      } catch {
        // Refused (not allowed here, or the user said no): use the fallback if there is one.
      }
    }
    if (this.fallback) {
      this.lockScroll();
      this.setMode("fixed");
    }
  }

  async exit(): Promise<void> {
    if (this.mode === "none") return;
    if (this.mode === "fixed") {
      this.setMode("none");
      return;
    }
    const doc = this.doc();
    try {
      if (doc?.exitFullscreen) await doc.exitFullscreen();
      else await doc?.webkitExitFullscreen?.();
    } catch {
      // Already out.
    }
    this.onDocumentChange();
    if (this.mode === "native") this.setMode("none");
  }

  async toggle(): Promise<void> {
    if (this.mode === "none") await this.enter();
    else await this.exit();
  }

  /** Leaves fullscreen and removes listeners. */
  destroy(): void {
    this.stopListening();
    if (this.mode === "native") void this.exit();
    this.unlockScroll();
    this.mode = "none";
    this.element = null;
  }

  // ---- internals -----------------------------------------------------------

  private doc(): (Document & FullscreenDocument) | null {
    return typeof document === "undefined" ? null : document;
  }

  private startListening(): void {
    const doc = this.doc();
    if (!doc || this.listening) return;
    doc.addEventListener("fullscreenchange", this.onDocumentChange);
    doc.addEventListener("webkitfullscreenchange", this.onDocumentChange);
    this.listening = true;
  }

  private stopListening(): void {
    const doc = this.doc();
    if (!doc || !this.listening) return;
    doc.removeEventListener("fullscreenchange", this.onDocumentChange);
    doc.removeEventListener("webkitfullscreenchange", this.onDocumentChange);
    this.listening = false;
  }

  private setMode(mode: FullscreenMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== "fixed") this.unlockScroll();
    this.onChange?.(mode);
  }

  /** The fixed fallback covers the page, so the page behind it must not scroll. */
  private lockScroll(): void {
    const body = this.doc()?.body;
    if (!body || this.savedOverflow !== null) return;
    this.savedOverflow = body.style.overflow;
    body.style.overflow = "hidden";
  }

  private unlockScroll(): void {
    const body = this.doc()?.body;
    if (!body || this.savedOverflow === null) return;
    body.style.overflow = this.savedOverflow;
    this.savedOverflow = null;
  }
}
