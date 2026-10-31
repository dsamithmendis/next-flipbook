import type { Scheduler } from "../../src/core/animation/scheduler.js";

/** Deterministic clock: nothing runs until `advance` is called. */
export class FakeScheduler implements Scheduler {
  time = 0;
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  now(): number {
    return this.time;
  }

  request(callback: () => void): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this.callbacks.delete(id);
  }

  /** Frames still scheduled. Zero means nothing is left running. */
  get pending(): number {
    return this.callbacks.size;
  }

  advance(ms: number): void {
    this.time += ms;
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback();
  }
}
