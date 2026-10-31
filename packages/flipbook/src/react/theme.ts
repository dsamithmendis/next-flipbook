import type { CSSProperties } from "react";
import type { FlipBookTheme } from "../types/index.js";

const THEMES: Record<FlipBookTheme, Record<string, string>> = {
  light: {
    "--flipbook-background": "#eef0f2",
    "--flipbook-toolbar-background": "rgba(255, 255, 255, 0.92)",
    "--flipbook-toolbar-color": "#1f2328",
    "--flipbook-page-background": "#ffffff",
    "--flipbook-shadow": "#000000",
    "--flipbook-accent": "#2563eb",
  },
  dark: {
    "--flipbook-background": "#121417",
    "--flipbook-toolbar-background": "rgba(30, 33, 37, 0.92)",
    "--flipbook-toolbar-color": "#e6e8eb",
    "--flipbook-page-background": "#f7f7f5",
    "--flipbook-shadow": "#000000",
    "--flipbook-accent": "#6ea8fe",
  },
};

/** Inline variables for an explicit `theme` prop, so it works without importing the CSS. */
export function themeVariables(theme: FlipBookTheme | undefined): CSSProperties {
  return (theme ? THEMES[theme] : {});
}
