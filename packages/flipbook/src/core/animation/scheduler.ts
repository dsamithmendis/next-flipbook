/** Frame scheduling seam: real browsers use rAF, tests inject a fake clock. */
export interface Scheduler {
  now(): number;
  request(callback: () => void): number;
  cancel(id: number): void;
}

/**
 * Browser globals are looked up when a method is called, never when this
 * module loads, so importing the package during SSR is always safe.
 */
export function createBrowserScheduler(): Scheduler {
  return {
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    request: (callback) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => callback())
        : (setTimeout(callback, 16) as unknown as number),
    cancel: (id) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
      else clearTimeout(id);
    },
  };
}
