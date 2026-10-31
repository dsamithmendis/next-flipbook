"use client";

import { useEffect, useMemo, useRef } from "react";
import { useConstant } from "./useConstant.js";
import { useLatest } from "./useLatest.js";
import {
  canvasToPrintable,
  printPages,
  type PrintSource,
} from "../../actions/print.js";
import { downloadSource, revokePendingDownloads } from "../../actions/download.js";
import { FullscreenController } from "../../actions/fullscreen.js";
import { shareLink } from "../../actions/share.js";
import { BookmarkStore, type BookmarkStorage } from "../../core/bookmarks/BookmarkStore.js";
import { toFlipBookError, type FlipBookError } from "../../core/errors.js";
import { UiStore } from "../../core/ui/UiStore.js";
import { isCancellation } from "../../pdf/errors.js";
import type { PdfManager } from "../../pdf/manager.js";
import type { PdfSource } from "../../pdf/types.js";
import type {
  BookmarkOptions,
  DownloadOptions,
  FlipBookFeatures,
  FlipBookLocale,
  FlipBookPage,
  PrintOptions,
  ShareOptions,
} from "../../types/index.js";
import { formatMessage } from "../locale.js";

export interface BookExtrasInput {
  pages: readonly FlipBookPage[];
  source: PdfSource | undefined;
  pdf: PdfManager;
  locale: FlipBookLocale;
  zoomEnabled: boolean;
  fullscreen: boolean;
  thumbnails: boolean;
  defaultThumbnailsOpen: boolean;
  bookmarks: boolean | BookmarkOptions;
  download: boolean | DownloadOptions;
  print: boolean | PrintOptions;
  share: boolean | ShareOptions;
  onShare: ((data: { url: string; title?: string; text?: string }) => void) | undefined;
  onFullscreenChange: ((fullscreen: boolean) => void) | undefined;
  reportError: (error: FlipBookError) => void;
}

export interface BookExtras {
  bookmarks: BookmarkStore;
  ui: UiStore;
  fullscreen: FullscreenController;
  features: Omit<FlipBookFeatures, "search" | "outline">;
  actions: { download: () => Promise<void>; print: () => Promise<void>; share: () => Promise<void> };
}

const KEY_PREFIX = "next-flipbook:bookmarks:";

/** `localStorage` throws when blocked (private modes, sandboxed frames), even to read the property. */
function defaultStorage(): BookmarkStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function bookmarkKey(persist: boolean | string | undefined, source: PdfSource | undefined): string | null {
  if (!persist) return null;
  if (typeof persist === "string") return `${KEY_PREFIX}${persist}`;
  if (typeof source === "string") return `${KEY_PREFIX}${source}`;
  if (source instanceof URL) return `${KEY_PREFIX}${source.href}`;
  return null;
}

const asObject = <T extends object>(value: boolean | T | undefined): T | null =>
  typeof value === "object" && value !== null ? value : value ? ({} as T) : null;

/**
 * Everything the toolbar, the side panel and the controller share beyond the
 * engine: bookmarks, panel and notice state, fullscreen, and the download,
 * print and share actions. Stores are created once per mounted viewer and
 * touch no browser global until the browser runs an effect.
 */
export function useBookExtras(input: BookExtrasInput): BookExtras {
  const latest = useLatest(input);

  const bookmarkOptions = asObject<BookmarkOptions>(input.bookmarks);

  const ui = useConstant(
    () => new UiStore({ panel: input.thumbnails && input.defaultThumbnailsOpen ? "thumbnails" : null }),
  );
  const bookmarks = useConstant(
    () =>
      new BookmarkStore({
        pageCount: input.pages.length,
        initial: bookmarkOptions?.value ?? bookmarkOptions?.defaultValue ?? [],
      }),
  );
  const fullscreen = useConstant(
    () =>
      new FullscreenController({
        onChange: (mode) => {
          ui.setFullscreen(mode);
          latest.current.onFullscreenChange?.(mode !== "none");
        },
      }),
  );

  // ---- bookmarks: size, saved state, controlled value, change events ------------

  const pageCount = input.pages.length;
  useEffect(() => {
    bookmarks.setPageCount(pageCount);
  }, [bookmarks, pageCount]);

  const persist = bookmarkOptions?.persist;
  const storageKey = bookmarkKey(persist, input.source);
  const customStorage = bookmarkOptions?.storage;
  useEffect(() => {
    if (persist && !storageKey) {
      latest.current.reportError({
        code: "INVALID_ARGUMENT",
        message:
          "`bookmarks.persist: true` needs a PDF `source` that is a URL. Pass a string key instead, for example `persist: \"my-catalog\"`.",
      });
    }
    if (!storageKey) {
      bookmarks.useStorage(null, null);
      return;
    }
    bookmarks.useStorage(customStorage ?? defaultStorage(), storageKey);
    bookmarks.hydrate();
    // Another tab changed the bookmarks.
    const onStorage = (event: StorageEvent): void => {
      if (event.key === storageKey) bookmarks.hydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [bookmarks, latest, persist, storageKey, customStorage]);

  // Declared after the saved state is loaded, so a controlled `value` wins.
  const controlled = bookmarkOptions?.value;
  const controlledKey = controlled ? controlled.join(",") : null;
  const controlledRef = useLatest(controlled);
  useEffect(() => {
    // `controlledKey` identifies the contents; the array may be a new object every render.
    if (controlledKey !== null && controlledRef.current) bookmarks.replace(controlledRef.current);
  }, [bookmarks, controlledRef, controlledKey]);

  useEffect(
    () =>
      bookmarks.onChange((pages, origin) => {
        if (origin === "user") asObject<BookmarkOptions>(latest.current.bookmarks)?.onChange?.(pages);
      }),
    [bookmarks, latest],
  );

  // ---- features ----------------------------------------------------------------

  const downloadOptions = asObject<DownloadOptions>(input.download);
  const hasDownloadTarget = downloadOptions?.url !== undefined || input.source !== undefined;
  const hasPrintable = input.pages.some((page) => page.type !== "custom");
  // The option objects can be new every render; only whether each is on matters.
  const { zoomEnabled, fullscreen: fullscreenOn, thumbnails: thumbnailsOn } = input;
  const bookmarksOn = bookmarkOptions !== null;
  const downloadOn = downloadOptions !== null && hasDownloadTarget;
  const printOn = Boolean(input.print) && hasPrintable;
  const shareOn = Boolean(input.share);
  const features = useMemo<Omit<FlipBookFeatures, "search" | "outline">>(
    () => ({
      zoom: zoomEnabled,
      fullscreen: fullscreenOn,
      thumbnails: thumbnailsOn,
      bookmarks: bookmarksOn,
      download: downloadOn,
      print: printOn,
      share: shareOn,
    }),
    [zoomEnabled, fullscreenOn, thumbnailsOn, bookmarksOn, downloadOn, printOn, shareOn],
  );

  // ---- actions -----------------------------------------------------------------

  const printAbort = useRef<AbortController | null>(null);
  const actions = useMemo<BookExtras["actions"]>(() => {
    const now = (): BookExtrasInput => latest.current;

    const download = async (): Promise<void> => {
      const { source, locale, reportError } = now();
      const options = asObject<DownloadOptions>(now().download) ?? {};
      const target: PdfSource | undefined = options.url ?? source;
      if (target === undefined) {
        ui.notify(locale.downloadFailed);
        return;
      }
      try {
        await downloadSource(target, options.filename ? { filename: options.filename } : {});
      } catch (reason) {
        reportError(
          toFlipBookError(reason, { code: "DOWNLOAD_FAILED", message: locale.downloadFailed }),
        );
        ui.notify(locale.downloadFailed);
      }
    };

    const print = async (): Promise<void> => {
      if (printAbort.current) return;
      const { pages, pdf, locale, reportError } = now();
      const options = asObject<PrintOptions>(now().print) ?? {};
      const scale = options.scale ?? 2;

      const indices: number[] = [];
      pages.forEach((page, index) => {
        if (page.type !== "custom") indices.push(index);
      });
      if (indices.length === 0) {
        ui.notify(locale.printNothing);
        return;
      }

      const source: PrintSource = {
        total: indices.length,
        load: async (index, signal) => {
          const page = pages[indices[index] as number];
          if (page?.type === "image") {
            return { src: new URL(page.src, document.baseURI).href };
          }
          if (page?.type === "pdf") {
            const session = pdf.getSession(page.source);
            if (!session || session.getSnapshot().status !== "ready") return null;
            const rendered = await session.renderOnce(page.page, scale, signal);
            return canvasToPrintable(rendered.canvas);
          }
          return null;
        },
      };

      const controller = new AbortController();
      printAbort.current = controller;
      let failed = false;
      const progress = (done: number, total: number): void => {
        ui.setPrinting({ done, total });
        ui.notify(formatMessage(locale.printPreparing, { done, total }), 0);
      };
      progress(0, indices.length);
      try {
        await printPages(source, {
          title: document.title || "Document",
          onProgress: progress,
          signal: controller.signal,
        });
      } catch (reason) {
        if (!isCancellation(reason)) {
          failed = true;
          reportError(toFlipBookError(reason, { code: "PRINT_FAILED", message: locale.printFailed }));
          ui.notify(locale.printFailed);
        }
      } finally {
        printAbort.current = null;
        ui.setPrinting(null);
        if (!failed) ui.clearNotice();
      }
    };

    const share = async (): Promise<void> => {
      const { locale, onShare } = now();
      const options = asObject<ShareOptions>(now().share) ?? {};
      const data: { url: string; title?: string; text?: string } = {
        url: options.url ?? location.href,
      };
      const title = options.title ?? (document.title || undefined);
      if (title) data.title = title;
      if (options.text) data.text = options.text;

      if (onShare) {
        onShare(data);
        return;
      }
      const result = await shareLink(data);
      if (result === "copied") ui.notify(locale.shareCopied);
      else if (result === "failed") ui.notify(locale.shareFailed);
    };

    return { download, print, share };
  }, [ui, latest]);

  // ---- teardown ----------------------------------------------------------------

  // Stops the notice timer, any print job and any pending object URL, and leaves
  // fullscreen. The stores are reusable, so React Strict Mode's remount is safe.
  useEffect(
    () => () => {
      ui.stop();
      printAbort.current?.abort();
      revokePendingDownloads();
      fullscreen.destroy();
    },
    [ui, fullscreen],
  );

  return { bookmarks, ui, fullscreen, features, actions };
}
