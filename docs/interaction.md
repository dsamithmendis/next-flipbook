# Gestures and zoom

## Turning pages by hand

Grab a page with the mouse, a finger or a pen and pull it towards the spine. The page follows the pointer; where you let go decides what happens.

- **Past halfway**, or released **faster than about 0.3 px/ms** in the direction of the turn, the page finishes turning.
- **Short of halfway**, or flicked back, it springs back and the reader stays where they were.
- Speed is measured over the last 100 ms before release, and the release itself counts as a sample, so pausing before letting go reads as zero speed.
- Dragging right pulls the previous page in a left-to-right book. In a right-to-left book both directions are mirrored.
- At the first or last page there is nothing to turn and the drag is ignored.

In double view the page edge tracks the pointer exactly (a full turn takes two page widths of travel). In single view the page runs ahead of the finger (one page width), which keeps the gesture short on a phone.

The page counter and `onPageChange` update at release when a turn is going to complete, and not at all when it springs back. `onPageTurnStart` fires when the page is lifted and `onPageTurnEnd` when it has settled, either way.

### What does not start a drag

- The press starts on a link, button, form field, `label`, `summary`, `[role="button"]`, editable content, or anything with `data-flipbook-no-drag`. Use that attribute to protect your own interactive widgets.
- A mouse press that is not the primary button.
- A touch whose first movement is mostly vertical: the browser scrolls the page (`touch-action: pan-y`) and the viewer stays out of the way.
- A second finger at any time: that is a pinch, and it cancels a turn already in progress.
- The book is zoomed in: one finger pans instead.

The click that ends a drag is swallowed so it cannot activate whatever was under the pointer.

Turn drag-to-turn off with `dragToTurn={false}`. While it is on, text on pages cannot be selected, because a press-and-drag is a page turn.

## Reduced motion

With `prefers-reduced-motion: reduce` (or `reducedMotion`), a swipe does not lift the page. A swipe of 40 px or more, or a fast flick, turns the page instantly.

## Zoom

1 is the fitted size: the largest book that fits the container. Zoom is clamped to `minZoom`..`maxZoom` (default 1 to 4).

| Input | Behaviour |
| --- | --- |
| Pinch | Scales about the point between your fingers, and moving both fingers pans |
| Double-tap, double-click | Jumps to `doubleTapZoom` (default 2) about that point; again returns to fitted |
| Ctrl/Cmd + wheel, trackpad pinch | Zooms about the pointer. `wheelZoom={true}` makes a plain wheel zoom too |
| Plain wheel while zoomed | Pans, and the page does not scroll |
| `+` / `=`, `-`, `0` | Zoom in, out, fit. Steps land on multiples of `zoomStep` |
| Controller | `zoomIn()`, `zoomOut()`, `setZoom(n)`, `fit()`, `fitWidth()`, `fitHeight()`, `getZoom()` |

Button, key and double-tap zoom animate (instant under reduced motion). Pinch and wheel apply immediately.

Panning is clamped so the book can never be dragged out of view, and a book smaller than the container stays centred. Arrow keys still turn pages while zoomed; the turn keeps the current zoom and pan.

`touch-action` on the stage is `pan-y` at the fitted size and `none` once zoomed, so a vertical swipe scrolls the page normally until you are zoomed in.

### Zoom state and events

`onZoomChange(zoom)` fires once, after the zoom has been still for 160 ms, not on every pinch frame. `useFlipBook().zoomState` re-renders at the same moment, apart from `zoomed`, which flips as soon as the book is larger than fitted. Pan never re-renders React.

### PDFs

Pages on screen are re-rendered for the zoomed size once the zoom settles, capped by `pdf.maxCanvasPixels`. The lower-resolution render stays visible until the sharp one is ready. Pages prepared in advance stay at the fitted size, so zooming in does not multiply the work.

## Using the pieces yourself

Everything above is built from two framework-free classes in `next-flipbook/core`:

- `GestureRecognizer` takes pointer events and calls your handlers (`onTurnStart`, `onTurnMove`, `onPan`, `onPinch`, `onDoubleTap`, ...). It has no DOM and no timers.
- `ZoomController` holds zoom and pan, clamps them, animates them, and tells you when they settle.
- `FlipBookEngine.beginDrag`, `dragTo` and `endDrag` drive a held page, with `dragProgress()` to turn pointer travel into page angle.
