"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { FlipBookEngine } from "../../core/engine/FlipBookEngine.js";
import {
  FLICK_VELOCITY,
  dragProgress,
  dragTravel,
  shouldCompleteTurn,
} from "../../core/interaction/drag.js";
import {
  GestureRecognizer,
  type GestureHandlers,
  type Point,
  type PointerInput,
  type PointerKind,
} from "../../core/interaction/GestureRecognizer.js";
import type { ZoomController } from "../../core/zoom/ZoomController.js";
import { useIsoLayoutEffect } from "./useIsoLayoutEffect.js";

export interface GestureSettings {
  /** False while the book is not drawn (loading, error, password prompt). */
  active: boolean;
  dragToTurn: boolean;
  zoomEnabled: boolean;
  /** `false` turns double-tap zoom off. */
  doubleTapZoom: number | false;
  wheelZoom: boolean | "ctrl";
  reducedMotion: boolean;
  /** Page width at zoom 1, in CSS pixels. Maps pointer travel to page angle. */
  pageWidth: number;
}

/** Elements that keep their own pointer behaviour: a drag never starts on them. */
const INTERACTIVE =
  "a[href], button, input, select, textarea, label, summary, [role='button'], " +
  "[contenteditable=''], [contenteditable='true'], [data-flipbook-no-drag]";

/** A swipe under reduced motion turns the page once it is this long, in pixels. */
const SWIPE_DISTANCE = 40;

const kindOf = (type: string): PointerKind =>
  type === "touch" ? "touch" : type === "pen" ? "pen" : "mouse";

/**
 * Connects pointer and wheel events on `ref` to the engine and the zoom
 * controller through a `GestureRecognizer`.
 *
 * One finger or the mouse turns a page (or pans when zoomed in), two fingers
 * pinch, a double tap or double click zooms, and Ctrl+wheel (a trackpad
 * pinch) zooms about the pointer. A drag never starts on a link, button or
 * form field, and the click that follows a drag is swallowed.
 */
export function useGestures(
  ref: RefObject<HTMLElement | null>,
  engine: FlipBookEngine,
  zoom: ZoomController,
  settings: GestureSettings,
): void {
  const live = useRef(settings);
  useIsoLayoutEffect(() => {
    live.current = settings;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let suppressClick = false;
    /** Under reduced motion a swipe turns the page instantly instead of dragging it. */
    let swipeOnly = false;

    /** Pointer position relative to the centre of the stage, which is where zoom pivots. */
    const focal = (point: Point): Point => {
      const rect = element.getBoundingClientRect();
      return { x: point.x - (rect.left + rect.width / 2), y: point.y - (rect.top + rect.height / 2) };
    };

    const handlers: GestureHandlers = {
      direction: () => engine.getState().direction,
      canTurn: () =>
        live.current.active &&
        live.current.dragToTurn &&
        !zoom.isZoomed() &&
        engine.getState().pageCount > 0,
      canZoom: () => live.current.active && live.current.zoomEnabled,
      isZoomed: () => zoom.isZoomed(),

      onTurnStart: (direction) => {
        if (live.current.reducedMotion) {
          swipeOnly = true;
          const { spreadIndex, spreadCount } = engine.getState();
          return direction === "forward" ? spreadIndex < spreadCount - 1 : spreadIndex > 0;
        }
        swipeOnly = false;
        return engine.beginDrag(direction);
      },

      onTurnMove: ({ pull, forward }) => {
        if (swipeOnly) return;
        const pageWidth = live.current.pageWidth * zoom.getTransform().zoom;
        const travel = dragTravel(engine.getState().view, pageWidth);
        engine.dragTo(dragProgress(pull, pageWidth, forward, travel));
      },

      onTurnEnd: ({ pull, velocity, forward, cancelled }) => {
        if (swipeOnly) {
          swipeOnly = false;
          if (cancelled || (pull < SWIPE_DISTANCE && velocity < FLICK_VELOCITY)) return;
          if (forward) engine.next();
          else engine.previous();
          return;
        }
        engine.endDrag({
          complete: shouldCompleteTurn({ progress: engine.getTurnProgress(), velocity, cancelled }),
        });
      },

      onPan: (dx, dy) => zoom.panBy(dx, dy),
      onPinchStart: (center) => zoom.beginPinch(focal(center)),
      onPinch: ({ scale, center }) => zoom.pinchTo(scale, focal(center)),
      onPinchEnd: () => zoom.endPinch(),
      onDoubleTap: (point) => {
        if (live.current.zoomEnabled && live.current.doubleTapZoom !== false) {
          zoom.toggle(focal(point));
        }
      },
    };

    const recognizer = new GestureRecognizer(handlers);

    const toInput = (event: PointerEvent): PointerInput => ({
      id: event.pointerId,
      kind: kindOf(event.pointerType),
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      button: event.button,
    });

    const release = (event: PointerEvent): void => {
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        // Already released, or not supported.
      }
    };

    const onDown = (event: PointerEvent): void => {
      if (!live.current.active) return;
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
      suppressClick = false;
      recognizer.pointerDown(toInput(event));
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety: it keeps a drag alive outside the element.
      }
    };
    const onMove = (event: PointerEvent): void => recognizer.pointerMove(toInput(event));
    const onUp = (event: PointerEvent): void => {
      recognizer.pointerUp(toInput(event));
      if (recognizer.dragged) suppressClick = true;
      release(event);
    };
    const onCancel = (event: PointerEvent): void => {
      recognizer.pointerCancel(toInput(event));
      if (recognizer.dragged) suppressClick = true;
      release(event);
    };

    // The click that follows a drag must not activate whatever is under the pointer.
    const onClick = (event: MouseEvent): void => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    // Stops the browser starting its own image drag.
    const onDragStart = (event: Event): void => {
      if (live.current.active) event.preventDefault();
    };

    const onWheel = (event: WheelEvent): void => {
      const settingsNow = live.current;
      if (!settingsNow.active || !settingsNow.zoomEnabled) return;

      const wantsZoom =
        settingsNow.wheelZoom === true ||
        (settingsNow.wheelZoom === "ctrl" && (event.ctrlKey || event.metaKey));
      if (wantsZoom) {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
        // A trackpad pinch sends small ctrl+wheel deltas, a mouse wheel sends large ones.
        const rate = event.ctrlKey ? 0.01 : 0.0025;
        zoom.zoomAround(Math.exp(-event.deltaY * unit * rate), focal({ x: event.clientX, y: event.clientY }));
        return;
      }
      if (zoom.isZoomed()) {
        event.preventDefault();
        zoom.panBy(-event.deltaX, -event.deltaY);
      }
    };

    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onCancel);
    element.addEventListener("click", onClick, true);
    element.addEventListener("dragstart", onDragStart);
    // Not passive: zooming has to cancel the browser's own page zoom or scroll.
    element.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onCancel);
      element.removeEventListener("click", onClick, true);
      element.removeEventListener("dragstart", onDragStart);
      element.removeEventListener("wheel", onWheel);
      recognizer.reset();
    };
  }, [ref, engine, zoom]);
}
