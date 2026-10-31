"use client";

import { useState } from "react";

/**
 * Creates a value on a component's first render and keeps it for as long as it is mounted.
 * For stores and controllers that live as long as the viewer does. `create` must be free of side
 * effects: React may call it twice in development and keep one of the results.
 */
export function useConstant<T>(create: () => T): T {
  return useState(create)[0];
}
