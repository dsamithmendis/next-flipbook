"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type Ref } from "react";
import type { FlipBookEngine } from "../../core/engine/FlipBookEngine.js";
import { computeTurnVisuals } from "../../core/animation/turn.js";
import type { FlipBookError } from "../../core/errors.js";
import {
  centeringShift,
  fitBook,
  resolveView,
  slotLeft,
  spineSide,
  type BookLayout,
  type PageSide,
} from "../../core/layout/sizing.js";
import type { Highlight } from "../../core/search/SearchController.js";
import type { EngineState } from "../../core/types.js";
import type { ZoomTransform } from "../../core/zoom/ZoomController.js";
import type { FlipBookPage, FlipBookStageProps } from "../../types/index.js";
import { useFlipBookContext } from "../context.js";
import { useElementSize } from "../hooks/useElementSize.js";
import { useEngineState } from "../hooks/useEngineState.js";
import { useIsoLayoutEffect } from "../hooks/useIsoLayoutEffect.js";
import { useGestures } from "../hooks/useGestures.js";
import { usePageAspect } from "../hooks/usePageAspect.js";
import {
  PAPER,
  bookTransform,
  castStyle,
  flatStyle,
  leafTransform,
  spineStyle,
} from "../styles.js";
import { formatMessage } from "../locale.js";
import { BookmarkRibbon } from "./BookmarkRibbon.js";
import { FlipBookPageView } from "./FlipBookPageView.js";
import { HotspotPopover } from "./HotspotPopover.js";
import { PageOverlays } from "./PageOverlays.js";
import { PasswordDialog } from "./PasswordDialog.js";

/**
 * Measures its container, picks single or double view, and draws the book.
 * Nothing is drawn on the server or before the first measurement, so there is
 * no hydration mismatch and no flash of the wrong layout.
 */
export function FlipBookStage(props: FlipBookStageProps) {
  const { aspectRatio = "auto", padding = 16, renderLoader, renderError, renderEmpty } = props;
  const {
    engine,
    imageLoader,
    pdf,
    zoom,
    bookmarks,
    search,
    interaction,
    document: documentState,
    password,
    pages,
    mode,
    breakpoint,
    locale,
    shadowStrength,
    reportError,
    notifyReady,
  } = useFlipBookContext();
  const state = useEngineState(engine);
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const { aspect, error: aspectError, imageError } = usePageAspect(pages, aspectRatio, imageLoader, pdf);
  const error = documentState.error ?? aspectError;

  const measured = size !== null && size.width > 0 && size.height > 0;
  const view = measured ? resolveView(mode, size.width, breakpoint) : null;

  // Layout effect: the engine switches view before the browser paints.
  useIsoLayoutEffect(() => {
    if (view !== null) engine.configure({ view });
  }, [engine, view]);

  const ready =
    measured && aspect !== null && view !== null && state.view === view && pages.length > 0;

  useEffect(() => {
    if (ready) notifyReady();
  }, [ready, notifyReady]);

  // Document failures are reported by the provider; this is the image-only case.
  useEffect(() => {
    if (imageError) reportError(imageError);
  }, [imageError, reportError]);

  const layout =
    ready && size !== null && aspect !== null
      ? fitBook({
          containerWidth: size.width - padding * 2,
          containerHeight: size.height - padding * 2,
          pageAspect: aspect,
          view: state.view,
        })
      : null;

  const pageWidth = layout?.pageWidth ?? 0;
  const bookWidth = layout?.bookWidth ?? 0;
  const pageHeight = layout?.pageHeight ?? 0;
  const viewWidth = size?.width ?? 0;
  const viewHeight = size?.height ?? 0;

  // Zoom needs the size of the view and of the book to keep panning in bounds.
  useIsoLayoutEffect(() => {
    if (bookWidth > 0) {
      zoom.setViewport({
        viewWidth,
        viewHeight,
        contentWidth: bookWidth,
        contentHeight: pageHeight,
        padding,
      });
    }
  }, [zoom, viewWidth, viewHeight, bookWidth, pageHeight, padding]);

  // PDF pages are drawn for the zoomed size once the zoom settles, so they stay
  // sharp. Pages prepared in advance use the fitted size.
  const zoomState = useSyncExternalStore(zoom.subscribe, zoom.getSnapshot, zoom.getSnapshot);
  const renderWidth = Math.max(1, Math.round(pageWidth * Math.max(1, zoomState.zoom)));
  useEffect(() => {
    if (pageWidth > 0) pdf.setViewportWidth(renderWidth, pageWidth);
  }, [pdf, renderWidth, pageWidth]);

  useGestures(containerRef, engine, zoom, {
    active: layout !== null,
    dragToTurn: interaction.dragToTurn,
    zoomEnabled: interaction.zoomEnabled,
    doubleTapZoom: interaction.doubleTapZoom,
    wheelZoom: interaction.wheelZoom,
    reducedMotion: interaction.reducedMotion,
    pageWidth,
  });

  const savedBookmarks = useSyncExternalStore(bookmarks.subscribe, bookmarks.getSnapshot, bookmarks.getSnapshot);
  const bookmarked = useMemo(() => new Set(savedBookmarks), [savedBookmarks]);

  // Where the current search found text, drawn over the pages.
  // Reading the snapshot subscribes to it; getHighlights() then answers for that snapshot, and
  // returns the same map until the next one, so there is nothing to memoise.
  useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot);
  const highlights = search.getHighlights();

  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const hasLayer = layout !== null;
  useIsoLayoutEffect(() => {
    const element = zoomLayerRef.current;
    if (!element) return;
    const apply = (transform: ZoomTransform): void => {
      element.style.transform = zoomTransformValue(transform);
    };
    apply(zoom.getTransform());
    return zoom.subscribeTransform(apply);
  }, [zoom, hasLayer]);

  let content: ReactNode;
  if (password) {
    content = (
      <PasswordDialog
        key={password.id}
        reason={password.reason}
        locale={locale}
        onSubmit={password.submit}
        onCancel={() => password.submit(null)}
      />
    );
  } else if (error) {
    content = renderError ? renderError(error) : <ErrorMessage error={error} />;
  } else if (pages.length === 0 && (documentState.status === "none" || documentState.status === "ready")) {
    content = renderEmpty ? renderEmpty() : <Message role="status">{locale.empty}</Message>;
  } else if (!ready || layout === null) {
    const progress = documentState.status === "loading" ? documentState.progress : null;
    content = renderLoader ? (
      renderLoader({ progress })
    ) : (
      <DefaultLoader progress={progress} label={locale.loading} template={locale.loadingProgress} />
    );
  } else {
    content = (
      // Not `will-change`: that would rasterise once and blur the page when zoomed in.
      <div
        ref={zoomLayerRef}
        data-flipbook-zoom=""
        style={{ flex: "none", position: "relative", transform: zoomTransformValue(zoom.getTransform()) }}
      >
        <Book
          engine={engine}
          state={state}
          pages={pages}
          layout={layout}
          renderWidth={renderWidth}
          bookmarked={bookmarked}
          highlights={highlights}
          shadowStrength={shadowStrength}
        />
        <HotspotPopoverHost state={state} layout={layout} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-flipbook-stage=""
      style={{
        touchAction: zoomState.zoomed
          ? "none"
          : interaction.dragToTurn || interaction.zoomEnabled
            ? "pan-y"
            : "auto",
        userSelect: interaction.dragToTurn || interaction.zoomEnabled ? "none" : undefined,
        WebkitUserSelect: interaction.dragToTurn || interaction.zoomEnabled ? "none" : undefined,
        cursor: zoomState.zoomed ? "grab" : undefined,
        position: "relative",
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {content}
    </div>
  );
}

const zoomTransformValue = (transform: ZoomTransform): string =>
  `translate3d(${transform.panX}px, ${transform.panY}px, 0) scale(${transform.zoom})`;

function Message({ role, children }: { role: "status" | "alert"; children: ReactNode }) {
  return (
    <div
      role={role}
      style={{
        padding: 24,
        textAlign: "center",
        font: "14px/1.5 system-ui, sans-serif",
        color: "var(--flipbook-toolbar-color, #1f2328)",
      }}
    >
      {children}
    </div>
  );
}

function DefaultLoader({
  progress,
  label,
  template,
}: {
  progress: number | null;
  label: string;
  template: string;
}) {
  const text =
    progress === null ? label : formatMessage(template, { percent: Math.round(progress * 100) });
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: 24,
        font: "14px/1.5 system-ui, sans-serif",
        color: "var(--flipbook-toolbar-color, #1f2328)",
      }}
    >
      <span>{text}</span>
      {progress === null ? null : (
        <progress
          value={progress}
          max={1}
          aria-label={text}
          style={{ width: 200, accentColor: "var(--flipbook-accent, #2563eb)" }}
        />
      )}
    </div>
  );
}

function ErrorMessage({ error }: { error: FlipBookError }) {
  return <Message role="alert">{error.message}</Message>;
}

// ---------------------------------------------------------------------------

interface BookProps {
  engine: FlipBookEngine;
  state: EngineState;
  pages: readonly FlipBookPage[];
  layout: BookLayout;
  /** Width PDF pages are rendered for: the page width, enlarged by the settled zoom. */
  renderWidth: number;
  /** Pages that wear a ribbon. */
  bookmarked: ReadonlySet<number>;
  /** Search matches by page. */
  highlights: ReadonlyMap<number, readonly Highlight[]>;
  shadowStrength: number;
}

/** The shade laid over a face while a page turns. Its element is reached through a separate ref. */
interface FaceShade {
  opacity: number;
  kind: "cast" | "flat";
}

/**
 * The physical model. While a turn runs, four page surfaces exist:
 *
 * - the verso page of the earlier spread stays put on the verso side,
 * - the recto page of the later spread waits under the leaf,
 * - the leaf's front is the earlier spread's recto page,
 * - the leaf's back is the later spread's verso page.
 *
 * This holds for forward and backward turns and for multi-spread jumps, so
 * at most four pages are ever in the DOM no matter how long the document is.
 */
function Book({ engine, state, pages, layout, renderWidth, bookmarked, highlights, shadowStrength }: BookProps) {
  const { pageWidth, pageHeight, bookWidth } = layout;
  const { view, direction, turn } = state;

  const bookRef = useRef<HTMLDivElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const frontShadeRef = useRef<HTMLDivElement>(null);
  const backShadeRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<HTMLDivElement>(null);

  let versoPage: number | null = state.spread.verso;
  let rectoPage: number | null = state.spread.recto;
  let frontPage: number | null = null;
  let backPage: number | null = null;
  let shift = centeringShift(state.spread, view, direction);
  let initial = null as ReturnType<typeof computeTurnVisuals> | null;

  if (turn) {
    const earlier = engine.getSpreadAt(Math.min(turn.from, turn.to));
    const later = engine.getSpreadAt(Math.max(turn.from, turn.to));
    versoPage = earlier.verso;
    rectoPage = later.recto;
    frontPage = earlier.recto;
    backPage = later.verso;
    const fromShift = centeringShift(engine.getSpreadAt(turn.from), view, direction);
    const toShift = centeringShift(engine.getSpreadAt(turn.to), view, direction);
    shift = fromShift;
    initial = computeTurnVisuals({
      forward: turn.forward,
      progress: 0,
      direction,
      shadowIntensity: shadowStrength,
      fromShift,
      toShift,
    });
  }

  // Animation frames are written straight to the DOM. React only renders when
  // a turn starts or ends, so a turn costs two renders, not sixty.
  useIsoLayoutEffect(() => {
    if (!turn) return;
    const fromShift = centeringShift(engine.getSpreadAt(turn.from), view, direction);
    const toShift = centeringShift(engine.getSpreadAt(turn.to), view, direction);

    const apply = (progress: number): void => {
      const v = computeTurnVisuals({
        forward: turn.forward,
        progress,
        direction,
        shadowIntensity: shadowStrength,
        fromShift,
        toShift,
      });
      if (leafRef.current) leafRef.current.style.transform = leafTransform(v.rotateY);
      if (frontShadeRef.current) frontShadeRef.current.style.opacity = String(v.frontShade);
      if (backShadeRef.current) backShadeRef.current.style.opacity = String(v.backShade);
      if (revealRef.current) revealRef.current.style.opacity = String(v.revealShade);
      if (castRef.current) castRef.current.style.opacity = String(v.castShade);
      if (bookRef.current) bookRef.current.style.transform = bookTransform(v.shift, pageWidth);
    };

    apply(engine.getTurnProgress());
    return engine.subscribeFrame(apply);
  }, [engine, turn, view, direction, shadowStrength, pageWidth]);

  const slot = (
    side: PageSide,
    number: number | null,
    shade: FaceShade | undefined,
    shadeRef: Ref<HTMLDivElement> | undefined,
  ) =>
    number === null ? null : (
      <div
        key={side}
        data-flipbook-page={number}
        style={{
          position: "absolute",
          top: 0,
          left: slotLeft(side, view, direction, pageWidth),
          width: pageWidth,
          height: pageHeight,
          zIndex: 1,
        }}
      >
        <PageFace
          page={pages[number - 1]}
          pageNumber={number}
          bookmarked={bookmarked.has(number)}
          highlights={highlights.get(number)}
          pageWidth={renderWidth}
          spine={spineSide(side, direction)}
          shade={shade}
          shadeRef={shadeRef}
        />
      </div>
    );

  const faceStyle = {
    position: "absolute",
    inset: 0,
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  } as const;

  return (
    <div
      ref={bookRef}
      data-flipbook-book=""
      data-view={view}
      style={{
        position: "relative",
        flex: "none",
        width: bookWidth,
        height: pageHeight,
        perspective: Math.round(pageWidth * 3),
        transform: bookTransform(shift, pageWidth),
        // In single view the page swings out past the book edge and is clipped.
        overflow: view === "single" ? "hidden" : "visible",
      }}
    >
      {slot("verso", versoPage, initial ? { opacity: initial.castShade, kind: "cast" } : undefined, castRef)}
      {slot("recto", rectoPage, initial ? { opacity: initial.revealShade, kind: "cast" } : undefined, revealRef)}

      {turn && initial ? (
        <div
          key={`${turn.from}-${turn.to}`}
          ref={leafRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: slotLeft("recto", view, direction, pageWidth),
            width: pageWidth,
            height: pageHeight,
            zIndex: 2,
            // The leaf is a moving picture of a page: nothing on it can be clicked.
            pointerEvents: "none",
            transformStyle: "preserve-3d",
            transformOrigin: direction === "ltr" ? "0% 50%" : "100% 50%",
            transform: leafTransform(initial.rotateY),
            willChange: "transform",
          }}
        >
          <div style={faceStyle}>
            <PageFace
              page={frontPage === null ? undefined : pages[frontPage - 1]}
              pageNumber={frontPage}
              bookmarked={frontPage !== null && bookmarked.has(frontPage)}
              highlights={frontPage === null ? undefined : highlights.get(frontPage)}
              pageWidth={renderWidth}
              spine={spineSide("recto", direction)}
              shade={{ opacity: initial.frontShade, kind: "flat" }}
              shadeRef={frontShadeRef}
            />
          </div>
          <div style={{ ...faceStyle, transform: "rotateY(180deg)" }}>
            <PageFace
              page={backPage === null ? undefined : pages[backPage - 1]}
              pageNumber={backPage}
              bookmarked={backPage !== null && bookmarked.has(backPage)}
              highlights={backPage === null ? undefined : highlights.get(backPage)}
              pageWidth={renderWidth}
              spine={spineSide("verso", direction)}
              shade={{ opacity: initial.backShade, kind: "flat" }}
              shadeRef={backShadeRef}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PageFace({
  page,
  pageNumber,
  bookmarked,
  highlights,
  pageWidth,
  spine,
  shade,
  shadeRef,
}: {
  page: FlipBookPage | undefined;
  pageNumber: number | null;
  bookmarked: boolean;
  highlights: readonly Highlight[] | undefined;
  pageWidth: number;
  spine: "left" | "right";
  shade: FaceShade | undefined;
  shadeRef: Ref<HTMLDivElement> | undefined;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: PAPER }}>
      {pageNumber === null ? null : (
        <FlipBookPageView page={page} pageNumber={pageNumber} pageWidth={pageWidth} />
      )}
      {pageNumber === null ? null : <PageOverlays pageNumber={pageNumber} highlights={highlights} />}
      <div aria-hidden="true" style={spineStyle(spine)} />
      {bookmarked ? <BookmarkRibbon side={spine === "left" ? "right" : "left"} /> : null}
      {shade ? (
        <div
          ref={shadeRef}
          aria-hidden="true"
          style={shade.kind === "flat" ? flatStyle(shade.opacity) : castStyle(spine, shade.opacity)}
        />
      ) : null}
    </div>
  );
}


const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Shows the popover of the open hotspot, next to it and above the book. It
 * closes when its page leaves the screen, when the reader presses anywhere
 * else, and from its own button; Escape is handled by the viewer.
 */
function HotspotPopoverHost({ state, layout }: { state: EngineState; layout: BookLayout }) {
  const { content, ui, locale } = useFlipBookContext();
  const activeId = useSyncExternalStore(ui.subscribe, () => ui.getSnapshot().hotspot, () => null);

  const hotspot = useMemo(() => {
    if (!activeId) return null;
    for (const list of content.hotspotsByPage.values()) {
      for (const candidate of list) if (candidate.id === activeId) return candidate;
    }
    return null;
  }, [activeId, content.hotspotsByPage]);

  const turning = state.turn !== null;
  const side: "verso" | "recto" | null =
    hotspot === null || turning
      ? null
      : state.spread.verso === hotspot.page
        ? "verso"
        : state.spread.recto === hotspot.page
          ? "recto"
          : null;

  // A hotspot whose page has gone is not open any more.
  useEffect(() => {
    if (hotspot && !turning && side === null) ui.setHotspot(null);
  }, [hotspot, turning, side, ui]);

  useEffect(() => {
    if (!hotspot) return;
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest("[data-flipbook-popover]")) return;
      // Pressing the hotspot itself is its own toggle.
      if (target?.closest("[data-flipbook-hotspot]")?.getAttribute("data-flipbook-hotspot") === hotspot.id) return;
      ui.setHotspot(null);
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [hotspot, ui]);

  if (!hotspot || hotspot.content === undefined || side === null) return null;

  const { pageWidth, pageHeight, bookWidth } = layout;
  const shift = centeringShift(state.spread, state.view, state.direction);
  const maxWidth = Math.max(160, Math.min(320, pageWidth * 0.9));
  const centre =
    slotLeft(side, state.view, state.direction, pageWidth) +
    (hotspot.x + hotspot.width / 2) * pageWidth +
    shift * pageWidth;
  const half = maxWidth / 2;
  const left = bookWidth > maxWidth ? clampNumber(centre, half, bookWidth - half) : centre;
  const above = hotspot.y + hotspot.height > 0.6;
  const top = above ? hotspot.y * pageHeight - 8 : (hotspot.y + hotspot.height) * pageHeight + 8;

  const close = (): void => {
    ui.setHotspot(null);
    for (const element of document.querySelectorAll("[data-flipbook-hotspot]")) {
      if (element.getAttribute("data-flipbook-hotspot") === hotspot.id) (element as HTMLElement).focus();
    }
  };

  return (
    <HotspotPopover
      label={hotspot.label ?? locale.hotspot}
      closeLabel={locale.closeHotspot}
      left={left}
      top={top}
      above={above}
      maxWidth={maxWidth}
      onClose={close}
    >
      {hotspot.content}
    </HotspotPopover>
  );
}
