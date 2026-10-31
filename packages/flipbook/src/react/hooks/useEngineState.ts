"use client";

import { useSyncExternalStore } from "react";
import type { FlipBookEngine } from "../../core/engine/FlipBookEngine.js";
import type { EngineState } from "../../core/types.js";

/** Subscribes to coarse engine changes (page, view, turn start and end). */
export function useEngineState(engine: FlipBookEngine): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}
