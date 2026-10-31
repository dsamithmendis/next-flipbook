"use client";

import { useEffect, useRef } from "react";
import type { FlipBookEngine } from "../../core/engine/FlipBookEngine.js";
import type { FlipBookError } from "../../core/errors.js";
import {
  readReadingState,
  writeReadingState,
  type StorageLike,
} from "../../core/persistence/readingState.js";
import type { ZoomController } from "../../core/zoom/ZoomController.js";
import type { PdfSource } from "../../pdf/types.js";
import type { PersistStateOptions, UrlStateOptions } from "../../types/index.js";
import { useIsoLayoutEffect } from "./useIsoLayoutEffect.js";
import { useLatest } from "./useLatest.js";

const KEY_PREFIX = "next-flipbook:state:";
const SAVE_DELAY_MS = 300;

export interface ReadingPositionInput {
  engine: FlipBookEngine;
  zoom: ZoomController;
  pageCount: number;
  source: PdfSource | undefined;
  urlState: boolean | UrlStateOptions | undefined;
  persistState: boolean | string | PersistStateOptions | undefined;
  reportError: (error: FlipBookError) => void;
}

interface UrlSettings {
  param: string;
  hash: boolean;
  history: "replace" | "push";
}

function urlSettings(option: boolean | UrlStateOptions | undefined): UrlSettings | null {
  if (!option) return null;
  const options = typeof option === "object" ? option : {};
  return { param: options.param ?? "page", hash: options.hash ?? false, history: options.history ?? "replace" };
}

/** The page named in the address, or null. */
export function readUrlPage(settings: Pick<UrlSettings, "param" | "hash">, href: string): number | null {
  try {
    const url = new URL(href);
    const params = settings.hash
      ? new URLSearchParams(url.hash.replace(/^#/, ""))
      : url.searchParams;
    const value = params.get(settings.param);
    if (value === null) return null;
    const page = Number(value);
    return Number.isInteger(page) && page >= 1 ? page : null;
  } catch {
    return null;
  }
}

/** The address with the page set, leaving everything else in it as it was. */
export function withUrlPage(settings: Pick<UrlSettings, "param" | "hash">, href: string, page: number): string {
  const url = new URL(href);
  if (settings.hash) {
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    params.set(settings.param, String(page));
    url.hash = params.toString();
  } else {
    url.searchParams.set(settings.param, String(page));
  }
  return url.toString();
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function persistKey(option: PersistStateOptions | string | boolean, source: PdfSource | undefined): string | null {
  const explicit = typeof option === "string" ? option : typeof option === "object" ? option.key : undefined;
  if (explicit) return `${KEY_PREFIX}${explicit}`;
  if (typeof source === "string") return `${KEY_PREFIX}${source}`;
  if (source instanceof URL) return `${KEY_PREFIX}${source.href}`;
  return null;
}

/**
 * Opens the book where the address or saved state says, and keeps both up to
 * date as the reader turns pages.
 *
 * Order of precedence on load: the address, then saved state, then
 * `initialPage`. Everything here runs in effects, so server rendering and
 * hydration are untouched.
 */
export function useReadingPosition(input: ReadingPositionInput): void {
  const { engine, zoom, pageCount } = input;
  const latest = useLatest(input);

  const url = urlSettings(input.urlState);
  const persist = input.persistState ? input.persistState : null;
  const persistOptions = typeof persist === "object" && persist !== null ? persist : {};
  const key = persist ? persistKey(persist, input.source) : null;
  const storage = persist ? (persistOptions.storage ?? defaultStorage()) : null;
  const rememberZoom = persistOptions.zoom ?? true;
  // The one-time restore and the address sync read the settings as they are when they run.
  const settings = useLatest({ url, storage, key, rememberZoom });

  useEffect(() => {
    if (persist && !key) {
      latest.current.reportError({
        code: "INVALID_ARGUMENT",
        message:
          "`persistState: true` needs a PDF `source` that is a URL. Pass a string key instead, for example `persistState: \"my-catalog\"`.",
      });
    }
  }, [latest, persist, key]);

  // Restore the page as soon as the book exists. A PDF has no pages yet, and
  // the engine then opens at this page once they arrive, so there is no flash
  // of the first page.
  const applied = useRef(false);
  useIsoLayoutEffect(() => {
    if (applied.current) return;
    applied.current = true;

    // Restoring is a one-time step; later changes to the options do not re-run it.
    const { url: fromAddress, storage: saving, key: savedKey } = settings.current;
    const fromUrl = fromAddress ? readUrlPage(fromAddress, window.location.href) : null;
    const saved = readReadingState(saving, savedKey);
    const page = fromUrl ?? saved?.page;
    if (page !== undefined) engine.jumpToPage(page);
  }, [engine, settings]);

  // Zoom needs the pages, so it waits for them.
  const zoomApplied = useRef(false);
  useIsoLayoutEffect(() => {
    if (zoomApplied.current || pageCount === 0) return;
    zoomApplied.current = true;
    // One-time, like the page.
    const { storage: saving, key: savedKey, rememberZoom: remember } = settings.current;
    const saved = remember ? readReadingState(saving, savedKey) : null;
    if (saved?.zoom !== undefined && saved.zoom > 1.01) zoom.zoomTo(saved.zoom, { animate: false });
  }, [zoom, pageCount, settings]);

  // Save the page, a moment after the reader stops turning.
  useEffect(() => {
    if (!storage || !key) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: number | null = null;
    const flush = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending !== null) writeReadingState(storage, key, { page: pending });
      pending = null;
    };
    const off = engine.on("pagechange", ({ page }) => {
      if (!applied.current) return;
      pending = page;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    });
    const offZoom = rememberZoom
      ? zoom.onChange((value) => writeReadingState(storage, key, { zoom: value }))
      : () => undefined;
    return () => {
      off();
      offZoom();
      flush();
    };
  }, [engine, zoom, storage, key, rememberZoom]);

  // Keep the address in step, and follow the back and forward buttons.
  const urlKey = url ? `${url.param}|${url.hash}|${url.history}` : "";
  useEffect(() => {
    const address = settings.current.url;
    if (!address) return;

    const off = engine.on("pagechange", ({ page }) => {
      if (!applied.current) return;
      if (readUrlPage(address, window.location.href) === page) return;
      const next = withUrlPage(address, window.location.href, page);
      if (address.history === "push") window.history.pushState(window.history.state, "", next);
      else window.history.replaceState(window.history.state, "", next);
    });

    const follow = (): void => {
      const page = readUrlPage(address, window.location.href);
      if (page !== null && page !== engine.getCurrentPage()) engine.goToPage(page);
    };
    window.addEventListener("popstate", follow);
    window.addEventListener("hashchange", follow);
    return () => {
      off();
      window.removeEventListener("popstate", follow);
      window.removeEventListener("hashchange", follow);
    };
  }, [engine, settings, urlKey]);
}
