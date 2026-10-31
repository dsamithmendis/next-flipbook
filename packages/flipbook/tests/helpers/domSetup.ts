import { vi } from "vitest";

/** `intersecting` decides which elements an IntersectionObserver reports as visible. */
export interface DomStubOptions {
  width?: number;
  height?: number;
  intersecting?: (element: Element) => boolean;
}

/**
 * Stubs the browser features jsdom lacks: sizes, ResizeObserver,
 * IntersectionObserver and a canvas context. Call `vi.restoreAllMocks()` and
 * `vi.unstubAllGlobals()` afterwards.
 */
export function installDomStubs(options: DomStubOptions = {}): void {
  const { width = 900, height = 600, intersecting = () => true } = options;

  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  class StubIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(element: Element): void {
      if (!intersecting(element)) return;
      queueMicrotask(() =>
        this.callback(
          [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
}
