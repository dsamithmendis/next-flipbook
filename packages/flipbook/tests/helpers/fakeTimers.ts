/** Manual timers for code that takes injectable `setTimer` / `clearTimer`. */
export class FakeTimers {
  now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { callback: () => void; at: number }>();

  readonly set = (callback: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.tasks.set(id, { callback, at: this.now + ms });
    return id;
  };

  readonly clear = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  get pending(): number {
    return this.tasks.size;
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, task] of [...this.tasks]) {
      if (task.at <= this.now) {
        this.tasks.delete(id);
        task.callback();
      }
    }
  }
}
