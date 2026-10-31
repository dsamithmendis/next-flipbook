"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { FlipBookEngine } from "../../core/engine/FlipBookEngine.js";
import { SearchController } from "../../core/search/SearchController.js";
import type { FlipBookOutlineItem } from "../../core/types.js";
import type { UiStore } from "../../core/ui/UiStore.js";
import type { PdfManager } from "../../pdf/manager.js";
import { sourceKey } from "../../pdf/source.js";
import type { PdfSource } from "../../pdf/types.js";
import type { FlipBookHotspot, FlipBookLink, FlipBookPage, SearchOptions } from "../../types/index.js";
import { mapOutline, positionIndex, positionOf } from "../outline.js";
import { isPdfPage } from "../pages.js";
import { useConstant } from "./useConstant.js";
import { useLatest } from "./useLatest.js";

export interface BookContentInput {
  pages: readonly FlipBookPage[];
  pdf: PdfManager;
  engine: FlipBookEngine;
  ui: UiStore;
  search: boolean | SearchOptions;
  outline: boolean;
  links: boolean;
  hotspots: readonly FlipBookHotspot[] | undefined;
  overlays: Readonly<Record<number, ReactNode>> | undefined;
  onSearch: ((query: string) => void) | undefined;
  onSearchResult: ((info: { query: string; count: number; truncated: boolean }) => void) | undefined;
  onLinkClick: ((link: FlipBookLink) => boolean | void) | undefined;
}

export interface BookContent {
  search: SearchController;
  /** Runs a search from the current page and reports it through the callbacks. */
  runSearch: (query: string) => Promise<void>;
  outline: FlipBookOutlineItem[] | null;
  getOutline: () => Promise<FlipBookOutlineItem[]>;
  /** The book page a page of a PDF is shown on, or null if it is not in the book. */
  positionOf: (source: PdfSource, docPage: number) => number | null;
  hotspotsByPage: ReadonlyMap<number, readonly FlipBookHotspot[]>;
  overlays: Readonly<Record<number, ReactNode>>;
  linksEnabled: boolean;
  /** Lets `onLinkClick` veto a link. Returns whether to go ahead. */
  allowLink: (link: FlipBookLink) => boolean;
  features: { search: boolean; outline: boolean };
}

const NO_OVERLAYS: Readonly<Record<number, ReactNode>> = {};

/**
 * Everything that comes from what is in the pages: search, the table of
 * contents, links, hotspots and overlays.
 */
export function useBookContent(input: BookContentInput): BookContent {
  const { pages, pdf, engine, ui } = input;
  const latest = useLatest(input);

  // ---- search --------------------------------------------------------------

  const searchOptions = typeof input.search === "object" ? input.search : {};
  const search = useConstant(() => new SearchController(searchOptions));
  // Only the numbers matter; the options object may be new on every render.
  const { minLength, maxResults } = searchOptions;
  useEffect(() => {
    search.configure({ minLength, maxResults });
  }, [search, minLength, maxResults]);

  const pageCount = pages.length;
  useEffect(() => {
    search.setSource({
      total: pageCount,
      getText: async (position, signal) => {
        const page = latest.current.pages[position - 1];
        if (!isPdfPage(page)) return null;
        const session = latest.current.pdf.getSession(page.source);
        if (!session || session.getSnapshot().status !== "ready") return null;
        return session.getPageText(page.page, signal);
      },
    });
  }, [search, latest, pageCount]);

  // Selecting a result takes the reader to its page.
  useEffect(() => search.onCurrent((result) => engine.goToPage(result.position)), [search, engine]);

  // Closing the search panel ends the search and removes the highlights.
  useEffect(
    () =>
      ui.subscribe(() => {
        if (ui.getSnapshot().panel === "search") return;
        const { status, query } = search.getSnapshot();
        if (status !== "idle" || query !== "") search.clear();
      }),
    [ui, search],
  );

  const runSearch = useMemo(
    () => async (query: string): Promise<void> => {
      if (query.trim() !== "") latest.current.onSearch?.(query);
      const snapshot = await search.search(query, { startPosition: engine.getCurrentPage() });
      if (snapshot.query === query && snapshot.status === "done") {
        latest.current.onSearchResult?.({
          query,
          count: snapshot.results.length,
          truncated: snapshot.truncated,
        });
      }
    },
    [search, engine, latest],
  );

  // ---- table of contents ---------------------------------------------------

  const index = useMemo(() => positionIndex(pages), [pages]);
  const indexRef = useLatest(index);

  const pdfVersion = useSyncExternalStore(pdf.subscribe, pdf.getVersion, pdf.getVersion);
  const firstPdf = pages.find(isPdfPage);
  const outlineSource = firstPdf?.source;
  const sourceId = outlineSource === undefined ? null : sourceKey(outlineSource);
  const ready =
    outlineSource !== undefined && pdf.getSession(outlineSource)?.getSnapshot().status === "ready";

  // The outline that was read, and which document it belongs to. What is shown is derived from it,
  // so turning the option off or changing the document needs no state reset in an effect.
  const [loaded, setLoaded] = useState<{ id: string; items: FlipBookOutlineItem[] } | null>(null);
  const wantOutline = input.outline && ready && outlineSource !== undefined && sourceId !== null;
  const outline = wantOutline && loaded?.id === sourceId ? loaded.items : null;
  useEffect(() => {
    if (!wantOutline || outlineSource === undefined || sourceId === null) return;
    const session = pdf.getSession(outlineSource);
    if (!session) return;
    let cancelled = false;
    session.getOutline().then(
      (items) => {
        if (!cancelled) {
          const mapped = mapOutline(items, (docPage) => positionOf(indexRef.current, outlineSource, docPage));
          setLoaded({ id: sourceId, items: mapped });
        }
      },
      () => {
        if (!cancelled) setLoaded({ id: sourceId, items: [] });
      },
    );
    return () => {
      cancelled = true;
    };
    // `sourceId` identifies the document; `pageCount` re-maps the outline onto the book's pages
    // and `pdfVersion` re-checks when a document finishes loading.
  }, [wantOutline, outlineSource, sourceId, pdf, indexRef, pageCount, pdfVersion]);

  const getOutline = useMemo(
    () => async (): Promise<FlipBookOutlineItem[]> => {
      const first = latest.current.pages.find(isPdfPage);
      if (!first) return [];
      const session = latest.current.pdf.getSession(first.source);
      if (!session || session.getSnapshot().status !== "ready") return [];
      const items = await session.getOutline();
      return mapOutline(items, (docPage) => positionOf(indexRef.current, first.source, docPage));
    },
    [latest, indexRef],
  );

  // ---- hotspots, overlays, links ---------------------------------------------

  const hotspotsByPage = useMemo(() => {
    const byPage = new Map<number, FlipBookHotspot[]>();
    for (const hotspot of input.hotspots ?? []) {
      const list = byPage.get(hotspot.page) ?? [];
      list.push(hotspot);
      byPage.set(hotspot.page, list);
    }
    return byPage;
  }, [input.hotspots]);

  // Stable, so they do not make the context value change on every render.
  const positionOfPage = useCallback(
    (source: PdfSource, docPage: number): number | null => positionOf(indexRef.current, source, docPage),
    [indexRef],
  );
  const allowLink = useCallback((link: FlipBookLink): boolean => latest.current.onLinkClick?.(link) !== false, [latest]);

  const searchEnabled = Boolean(input.search) && pages.some(isPdfPage);
  const outlineEnabled = input.outline && (outline?.length ?? 0) > 0;

  return {
    search,
    runSearch,
    outline,
    getOutline,
    positionOf: positionOfPage,
    hotspotsByPage,
    overlays: input.overlays ?? NO_OVERLAYS,
    linksEnabled: input.links,
    allowLink,
    features: { search: searchEnabled, outline: outlineEnabled },
  };
}
