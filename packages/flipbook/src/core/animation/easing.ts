export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Exponential-decay ease used when a released page springs back: fast at
 * first, then settling softly. Normalised so it ends exactly at 1.
 */
export function springEase(t: number): number {
  const rate = 7;
  return (1 - Math.exp(-rate * t)) / (1 - Math.exp(-rate));
}
