"use client";

import { useEffect, useLayoutEffect } from "react";

/** `useLayoutEffect` in the browser, `useEffect` on the server (no SSR warning). */
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
