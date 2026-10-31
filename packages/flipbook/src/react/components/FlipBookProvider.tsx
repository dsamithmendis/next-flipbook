"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { FlipBookEngine } from "../../core/engine/FlipBookEngine.js";
import { ZoomController } from "../../core/zoom/ZoomController.js";
import type { FlipBookError } from "../../core/errors.js";
import { ImageLoader } from "../../image/loader.js";
import { PdfManager } from "../../pdf/manager.js";
import type { PdfSource } from "../../pdf/types.js";
import type { FlipBookBookProps, FlipBookLocale, FlipBookPage } from "../../types/index.js";
import {
  FlipBookContext,
  type DocumentState,
  type FlipBookContextValue,
  type PasswordPrompt,
} from "../context.js";
import { createController } from "../controller.js";
import { useBookContent } from "../hooks/useBookContent.js";
import { useBookExtras } from "../hooks/useBookExtras.js";
import { useConstant } from "../hooks/useConstant.js";
import { useLatest, useLatestGetter } from "../hooks/useLatest.js";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import { useReadingPosition } from "../hooks/useReadingPosition.js";
import { DEFAULT_LOCALE } from "../locale.js";
import { isImagePage, isPdfPage, normalizePages } from "../pages.js";

export interface FlipBookProviderProps extends FlipBookBookProps {
  children?: ReactNode;
}

const NO_DOCUMENT: DocumentState = { status: "none", progress: null, error: null };
const LOADING_DOCUMENT: DocumentState = { status: "loading", progress: null, error: null };

/**
 * Owns the engine, the image loader and the PDF manager, and exposes them
 * through context. Use it directly to build a fully custom viewer with
 * `useFlipBook()`, `<FlipBookStage />` and `<FlipBookControls />`.
 */
export function FlipBookProvider(props: FlipBookProviderProps) {
  const {
    source,
    pages: pagesInput,
    pdf: pdfOptions,
    cacheSize = 10,
    zoom: zoomEnabled = true,
    minZoom = 1,
    maxZoom = 4,
    zoomStep = 0.25,
    doubleTapZoom = 2,
    wheelZoom = "ctrl",
    dragToTurn = true,
    fullscreen: fullscreenEnabled = true,
    thumbnails = false,
    defaultThumbnailsOpen = false,
    bookmarks: bookmarksProp = false,
    download: downloadProp = false,
    print: printProp = false,
    share: shareProp = false,
    search: searchProp = false,
    outline: outlineProp = false,
    links = true,
    hotspots,
    overlays,
    urlState,
    persistState,
    mode = "auto",
    direction = "ltr",
    cover = false,
    initialPage = 1,
    breakpoint = 640,
    duration = 700,
    whileTurning = "queue",
    reducedMotion = "auto",
    shadow = true,
    shadowIntensity = 0.5,
    preloadPages = 2,
    locale,
    onReady,
    onPageChange,
    onPageTurnStart,
    onPageTurnEnd,
    onError,
    onPassword,
    onDocumentLoaded,
    onPageLoaded,
    onPageError,
    onZoomChange,
    onShare,
    onFullscreenChange,
    onSearch,
    onSearchResult,
    onLinkClick,
    children,
  } = props;

  const declared = useMemo(() => normalizePages(pagesInput ?? []), [pagesInput]);
  const systemReducedMotion = usePrefersReducedMotion();
  const reduceMotion = reducedMotion === "auto" ? systemReducedMotion : reducedMotion;

  // Callbacks and settings are read through refs so effects never re-subscribe
  // just because the parent passed a new inline function or object.
  const callbacks = useLatest({
    onReady,
    onPageChange,
    onPageTurnStart,
    onPageTurnEnd,
    onError,
    onPassword,
    onDocumentLoaded,
    onPageLoaded,
    onPageError,
    onZoomChange,
  });
  const pdfOptionsRef = useLatest(pdfOptions);
  const cacheSizeRef = useLatest(cacheSize);

  // Created lazily, once per mounted provider. None of these constructors
  // touches browser globals, so they are safe to run during server rendering.
  const engine = useConstant(
    () =>
      new FlipBookEngine({
        pageCount: source === undefined ? declared.length : 0,
        view: mode === "single" ? "single" : "double",
        cover,
        direction,
        initialPage,
        duration,
        reducedMotion: reduceMotion,
        whileTurning,
      }),
  );
  const zoom = useConstant(
    () =>
      new ZoomController({
        enabled: zoomEnabled,
        minZoom,
        maxZoom,
        zoomStep,
        doubleTapZoom: doubleTapZoom === false ? 2 : doubleTapZoom,
        reducedMotion: reduceMotion,
      }),
  );
  const imageLoader = useConstant(() => new ImageLoader());
  const pdf = useConstant(
    () =>
      new PdfManager({
        options: () => pdfOptionsRef.current ?? {},
        cacheSize: () => cacheSizeRef.current,
        events: () => ({
          onDocumentLoaded: (info) => callbacks.current.onDocumentLoaded?.(info),
          onPageLoaded: (page) => callbacks.current.onPageLoaded?.(page),
          onPageError: (error) => callbacks.current.onPageError?.(error),
        }),
      }),
  );

  // Re-render whenever a PDF loads, asks for a password, fails, or the page size changes.
  const pdfVersion = useSyncExternalStore(pdf.subscribe, pdf.getVersion, pdf.getVersion);

  // ---- which pages does the book have? -----------------------------------

  const primary = source === undefined ? undefined : pdf.getSession(source);
  const primarySnapshot = primary?.getSnapshot();
  const bothGiven = source !== undefined && declared.length > 0;

  const pages = useMemo<FlipBookPage[]>(() => {
    if (source !== undefined && !bothGiven) {
      const count = primarySnapshot?.status === "ready" ? primarySnapshot.numPages : 0;
      return Array.from({ length: count }, (_, index) => ({
        type: "pdf" as const,
        source,
        page: index + 1,
      }));
    }
    return declared;
  }, [source, bothGiven, primarySnapshot, declared]);

  const pagesRef = useLatest<readonly FlipBookPage[]>(pages);

  // ---- errors ------------------------------------------------------------

  const reported = useConstant(() => new Set<string>());
  const reportError = useCallback((error: FlipBookError) => {
    const key = `${error.code}|${error.page ?? ""}|${error.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    callbacks.current.onError?.(error);
  }, [callbacks, reported]);
  const reportPageError = useCallback((error: FlipBookError) => {
    callbacks.current.onPageError?.(error);
  }, [callbacks]);
  const notifyReady = useCallback(() => callbacks.current.onReady?.(), [callbacks]);

  useEffect(() => {
    if (bothGiven) {
      reportError({
        code: "INVALID_ARGUMENT",
        message: "Pass either `source` or `pages`, not both. `pages` is being used.",
      });
    }
  }, [bothGiven, reportError]);

  useEffect(() => {
    for (const { id, error } of pdf.getSessionErrors()) {
      const key = `session:${id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      callbacks.current.onError?.(error);
    }
  }, [pdf, pdfVersion, callbacks, reported]);

  // ---- engine wiring -------------------------------------------------------

  useEffect(() => {
    const unsubscribe = [
      engine.on("pagechange", ({ page }) => callbacks.current.onPageChange?.(page)),
      engine.on("turnstart", (event) => callbacks.current.onPageTurnStart?.(event)),
      engine.on("turnend", ({ page }) => callbacks.current.onPageTurnEnd?.(page)),
    ];
    return () => {
      for (const off of unsubscribe) off();
    };
  }, [engine, callbacks]);

  useEffect(() => {
    engine.configure({
      pageCount: pages.length,
      cover,
      direction,
      duration,
      reducedMotion: reduceMotion,
      whileTurning,
    });
  }, [engine, pages.length, cover, direction, duration, reduceMotion, whileTurning]);

  useEffect(() => {
    zoom.configure({
      enabled: zoomEnabled,
      minZoom,
      maxZoom,
      zoomStep,
      doubleTapZoom: doubleTapZoom === false ? 2 : doubleTapZoom,
      reducedMotion: reduceMotion,
    });
  }, [zoom, zoomEnabled, minZoom, maxZoom, zoomStep, doubleTapZoom, reduceMotion]);

  useEffect(
    () => zoom.onChange((value) => callbacks.current.onZoomChange?.(value)),
    [zoom, callbacks],
  );

  // ---- PDF documents -------------------------------------------------------

  const pdfSources = useMemo(() => {
    const list: PdfSource[] = [];
    if (source !== undefined) list.push(source);
    for (const page of declared) if (isPdfPage(page)) list.push(page.source);
    return list;
  }, [source, declared]);

  // Syncing is cheap and does nothing when the documents are the same.
  useEffect(() => {
    pdf.sync(pdfSources);
  }, [pdf, pdfSources]);

  useEffect(() => {
    pdf.updateLimits();
  }, [pdf, cacheSize, pdfOptions?.maxCacheBytes]);

  // Password prompts: the built-in dialog, or the app's `onPassword`.
  const request = pdf.getPasswordRequest();
  const handledRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!request || !callbacks.current.onPassword) return;
    if (handledRequest.current === request.id) return;
    handledRequest.current = request.id;
    callbacks.current.onPassword((password) => request.session.submitPassword(password), request.reason);
  }, [request, callbacks]);

  const hasPasswordHandler = onPassword !== undefined;
  const password = useMemo<PasswordPrompt | null>(
    () =>
      request && !hasPasswordHandler
        ? {
            id: request.id,
            reason: request.reason,
            submit: (value) => request.session.submitPassword(value),
          }
        : null,
    [request, hasPasswordHandler],
  );

  const document = useMemo<DocumentState>(() => {
    if (source === undefined) return NO_DOCUMENT;
    if (!primarySnapshot) return LOADING_DOCUMENT;
    return {
      status: primarySnapshot.status,
      progress: primarySnapshot.progress,
      error: primarySnapshot.error,
    };
  }, [source, primarySnapshot]);

  // ---- warm the caches around the visible pages ---------------------------

  useEffect(() => {
    const prepare = (): void => {
      const { visiblePages } = engine.getState();
      const first = visiblePages[0];
      const last = visiblePages[visiblePages.length - 1];
      if (first === undefined || last === undefined) return;

      const list = pagesRef.current;
      const from = Math.max(1, first - preloadPages);
      const to = Math.min(list.length, last + preloadPages);
      const images: string[] = [];
      for (let n = from; n <= to; n += 1) {
        const page = list[n - 1];
        if (isImagePage(page)) images.push(page.src);
      }
      imageLoader.preload(images);

      pdf.focus({
        visible: visiblePages,
        total: list.length,
        radius: preloadPages,
        resolve: (position) => {
          const page = pagesRef.current[position - 1];
          return isPdfPage(page) ? { source: page.source, page: page.page } : null;
        },
      });
    };
    prepare();
    const offEngine = engine.subscribe(prepare);
    const offPdf = pdf.subscribe(prepare);
    return () => {
      offEngine();
      offPdf();
    };
  }, [engine, imageLoader, pdf, pagesRef, preloadPages]);

  // Stops animation, aborts image requests, cancels renders and terminates
  // PDF workers on unmount. The engine is stopped, not destroyed, so React
  // Strict Mode's mount / unmount / mount sequence is safe.
  useEffect(
    () => () => {
      engine.stop();
      zoom.stop();
      imageLoader.dispose();
      pdf.dispose();
    },
    [engine, zoom, imageLoader, pdf],
  );

  // `locale` is a new object on every render when passed inline, and it is only strings, so its
  // text is what identifies it.
  const localeText = locale ? JSON.stringify(locale) : "";
  const mergedLocale = useMemo(
    () => ({ ...DEFAULT_LOCALE, ...(localeText ? (JSON.parse(localeText) as Partial<FlipBookLocale>) : {}) }),
    [localeText],
  );

  const extras = useBookExtras({
    pages,
    source,
    pdf,
    locale: mergedLocale,
    zoomEnabled,
    fullscreen: fullscreenEnabled,
    thumbnails,
    defaultThumbnailsOpen,
    bookmarks: bookmarksProp,
    download: downloadProp,
    print: printProp,
    share: shareProp,
    onShare,
    onFullscreenChange,
    reportError,
  });

  const content = useBookContent({
    pages,
    pdf,
    engine,
    ui: extras.ui,
    search: searchProp,
    outline: outlineProp,
    links,
    hotspots,
    overlays,
    onSearch,
    onSearchResult,
    onLinkClick,
  });

  useReadingPosition({
    engine,
    zoom,
    pageCount: pages.length,
    source,
    urlState,
    persistState,
    reportError,
  });

  const { search: searchFeature, outline: outlineFeature } = content.features;
  const features = useMemo(
    () => ({ ...extras.features, search: searchFeature, outline: outlineFeature }),
    [extras.features, searchFeature, outlineFeature],
  );
  // The controller outlives any one render, so it asks for the newest features and locale when it
  // needs them instead of holding the ones it was created with.
  const getFeatures = useLatestGetter(features);
  const getLocale = useLatestGetter(mergedLocale);

  const controller = useMemo(
    () =>
      createController({
        engine,
        zoom,
        bookmarks: extras.bookmarks,
        ui: extras.ui,
        fullscreen: extras.fullscreen,
        actions: extras.actions,
        search: content.search,
        runSearch: content.runSearch,
        getOutline: content.getOutline,
        getCacheStats: () => pdf.getCacheStats(),
        getFeatures,
        getLocale,
      }),
    [engine, zoom, pdf, extras.bookmarks, extras.ui, extras.fullscreen, extras.actions, content.search, content.runSearch, content.getOutline, getFeatures, getLocale],
  );

  const { bookmarks: bookmarkStore, ui, fullscreen, actions } = extras;
  const { outline, positionOf, hotspotsByPage, overlays: pageOverlays, linksEnabled, allowLink, runSearch } = content;
  const searchController = content.search;
  const value = useMemo<FlipBookContextValue>(
    () => ({
      engine,
      controller,
      imageLoader,
      pdf,
      zoom,
      bookmarks: bookmarkStore,
      ui,
      fullscreen,
      features,
      search: searchController,
      content: { outline, positionOf, hotspotsByPage, overlays: pageOverlays, linksEnabled, allowLink, runSearch },
      actions,
      interaction: {
        zoomEnabled,
        dragToTurn,
        wheelZoom,
        doubleTapZoom,
        reducedMotion: reduceMotion,
      },
      document,
      password,
      pages,
      mode,
      breakpoint,
      direction,
      locale: mergedLocale,
      shadowStrength: shadow ? shadowIntensity : 0,
      reportError,
      reportPageError,
      notifyReady,
    }),
    [
      engine,
      controller,
      imageLoader,
      pdf,
      zoom,
      bookmarkStore,
      ui,
      fullscreen,
      features,
      searchController,
      outline,
      positionOf,
      hotspotsByPage,
      pageOverlays,
      linksEnabled,
      allowLink,
      runSearch,
      actions,
      zoomEnabled,
      dragToTurn,
      wheelZoom,
      doubleTapZoom,
      reduceMotion,
      document,
      password,
      pages,
      mode,
      breakpoint,
      direction,
      mergedLocale,
      shadow,
      shadowIntensity,
      reportError,
      reportPageError,
      notifyReady,
    ],
  );

  return <FlipBookContext.Provider value={value}>{children}</FlipBookContext.Provider>;
}
