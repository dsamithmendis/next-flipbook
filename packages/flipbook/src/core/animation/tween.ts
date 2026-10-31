import { easeInOutCubic } from "./easing.js";
import type { Scheduler } from "./scheduler.js";

export interface TweenHandle {
  cancel: () => void;
}

export interface TweenOptions {
  duration: number;
  easing?: (t: number) => number;
  /** Receives eased progress in the range 0..1. */
  onUpdate: (progress: number) => void;
  onComplete: () => void;
}

/** Runs one time-based animation on the scheduler. Cancelling stops all further frames. */
export function tween(scheduler: Scheduler, options: TweenOptions): TweenHandle {
  const { duration, easing = easeInOutCubic, onUpdate, onComplete } = options;
  const start = scheduler.now();
  let cancelled = false;
  let frameId = 0;

  const frame = (): void => {
    if (cancelled) return;
    const t = duration <= 0 ? 1 : Math.min(1, (scheduler.now() - start) / duration);
    onUpdate(easing(t));
    if (t >= 1) {
      onComplete();
      return;
    }
    frameId = scheduler.request(frame);
  };

  frameId = scheduler.request(frame);

  return {
    cancel() {
      cancelled = true;
      scheduler.cancel(frameId);
    },
  };
}
