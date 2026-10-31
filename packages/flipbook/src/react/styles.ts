import type { CSSProperties } from "react";

export const PAPER = "var(--flipbook-page-background, #ffffff)";
const SHADOW = "var(--flipbook-shadow, #000000)";

const toward = (spine: "left" | "right"): string => (spine === "left" ? "to right" : "to left");

/** Permanent soft crease along the bound edge of a page. */
export function spineStyle(spine: "left" | "right"): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    [spine]: 0,
    width: "14%",
    pointerEvents: "none",
    background: `linear-gradient(${toward(spine)}, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0))`,
  };
}

/** Shadow gradient that fades away from the spine. Its opacity is animated. */
export function castStyle(spine: "left" | "right", opacity: number): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    opacity,
    background: `linear-gradient(${toward(spine)}, ${SHADOW}, transparent 70%)`,
  };
}

/** Uniform darkening used to fake lighting on the turning leaf. */
export function flatStyle(opacity: number): CSSProperties {
  return { position: "absolute", inset: 0, pointerEvents: "none", opacity, background: SHADOW };
}

export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export const leafTransform = (rotateY: number): string => `rotateY(${rotateY}deg)`;

export const bookTransform = (shift: number, pageWidth: number): string =>
  `translate3d(${shift * pageWidth}px, 0, 0)`;
