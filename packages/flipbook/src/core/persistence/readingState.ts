/** The part of `Storage` that saved state needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Where the reader was. */
export interface ReadingState {
  page?: number;
  zoom?: number;
}

const FORMAT_VERSION = 1;

/** Loads saved state. Anything missing, malformed or out of range is dropped; this never throws. */
export function readReadingState(storage: StorageLike | null, key: string | null): ReadingState | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { page?: unknown; zoom?: unknown } | null;
    if (typeof parsed !== "object" || parsed === null) return null;
    const state: ReadingState = {};
    if (typeof parsed.page === "number" && Number.isInteger(parsed.page) && parsed.page >= 1) {
      state.page = parsed.page;
    }
    if (typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom) && parsed.zoom >= 0.1 && parsed.zoom <= 20) {
      state.zoom = parsed.zoom;
    }
    return state;
  } catch {
    return null;
  }
}

/** Saves state, merged over what is already saved. A full or blocked storage is ignored. */
export function writeReadingState(
  storage: StorageLike | null,
  key: string | null,
  patch: ReadingState,
): void {
  if (!storage || !key) return;
  try {
    const current = readReadingState(storage, key) ?? {};
    storage.setItem(key, JSON.stringify({ v: FORMAT_VERSION, ...current, ...patch }));
  } catch {
    // Nothing useful to do: the reader just starts from the top next time.
  }
}
