import type { FlipBookView } from "../types.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Speed, in pixels per millisecond, above which a release counts as a flick. */
export const FLICK_VELOCITY = 0.3;

/**
 * How far the pointer must travel, in pixels, to turn a page all the way.
 *
 * In double view a page's free edge sweeps across the whole book, so the page
 * can follow the pointer exactly (two page widths). In single view the page
 * is clipped once it passes edge-on, so one page width is plenty and the page
 * runs ahead of the finger, which keeps the gesture short on a phone.
 */
export function dragTravel(view: FlipBookView, pageWidth: number): number {
  return view === "double" ? pageWidth * 2 : pageWidth;
}

/**
 * Turn progress (0..1) for a pointer that has moved `pull` pixels in the
 * direction of the turn.
 *
 * The page's free edge follows the pointer, so progress follows the cosine of
 * the page angle rather than being linear: the page lifts quickly at first,
 * is edge-on halfway, and flattens on the far side. `progress` matches the
 * convention of scripted turns: 0 is where the turn began, 1 is fully turned,
 * for forward and backward turns alike.
 */
export function dragProgress(
  pull: number,
  pageWidth: number,
  forward: boolean,
  travel: number = pageWidth * 2,
): number {
  if (pageWidth <= 0 || travel <= 0) return 0;
  const edge = (Math.max(0, pull) * 2 * pageWidth) / travel; // pixels the free edge moved
  const cosine = forward ? 1 - edge / pageWidth : -1 + edge / pageWidth;
  const angle = Math.acos(clamp(cosine, -1, 1));
  return forward ? angle / Math.PI : 1 - angle / Math.PI;
}

/**
 * Decides whether a released page finishes turning or springs back.
 * `velocity` is signed: positive means the pointer was moving in the turn direction.
 */
export function shouldCompleteTurn(input: {
  progress: number;
  velocity: number;
  cancelled?: boolean;
}): boolean {
  if (input.cancelled) return false;
  if (input.velocity > FLICK_VELOCITY) return true;
  if (input.velocity < -FLICK_VELOCITY) return false;
  return input.progress >= 0.5;
}
