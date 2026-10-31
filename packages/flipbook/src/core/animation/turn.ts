import type { FlipBookDirection } from "../types.js";
import { clamp01 } from "./easing.js";

export interface TurnVisualsInput {
  forward: boolean;
  /** Eased progress, 0..1. */
  progress: number;
  direction: FlipBookDirection;
  /** 0 disables shading, 1 is the strongest. */
  shadowIntensity: number;
  /** Book shift at the start and end of the turn, in page widths. */
  fromShift: number;
  toShift: number;
}

export interface TurnVisuals {
  /** How far the leaf has swung away from the recto side, 0..180 degrees. */
  angle: number;
  /** Signed CSS `rotateY` value for the leaf. */
  rotateY: number;
  /** Darkening on the leaf's front face (visible below 90 degrees). */
  frontShade: number;
  /** Darkening on the leaf's back face (visible above 90 degrees). */
  backShade: number;
  /** Shadow the leaf casts on the recto page it uncovers. */
  revealShade: number;
  /** Shadow the leaf casts on the verso page it lands on. */
  castShade: number;
  /** Book shift in page widths. */
  shift: number;
}

/**
 * Pure description of one animation frame. The React layer writes these
 * numbers straight to the DOM, so a page turn never triggers a React render.
 */
export function computeTurnVisuals(input: TurnVisualsInput): TurnVisuals {
  const progress = clamp01(input.progress);
  const strength = clamp01(input.shadowIntensity);

  const angle = input.forward ? progress * 180 : (1 - progress) * 180;
  const radians = (angle * Math.PI) / 180;

  const frontShade = angle < 90 ? (angle / 90) * 0.35 * strength : 0;
  const backShade = angle > 90 ? ((180 - angle) / 90) * 0.35 * strength : 0;
  const revealShade =
    angle <= 90
      ? Math.sin(radians) * 0.55 * strength
      : Math.sin(radians) * ((180 - angle) / 90) * 0.55 * strength;
  const castShade =
    angle > 90 ? Math.sin(((angle - 90) / 90) * Math.PI) * 0.45 * strength : 0;

  return {
    angle,
    rotateY: input.direction === "ltr" ? -angle : angle,
    frontShade,
    backShade,
    revealShade,
    castShade,
    shift: input.fromShift + (input.toShift - input.fromShift) * progress,
  };
}
