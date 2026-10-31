"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { FlipBookController } from "../../core/types.js";
import type { FlipBookProps } from "../../types/index.js";
import { useFlipBookContext } from "../context.js";
import { useElementSize } from "../hooks/useElementSize.js";
import { useFlipBook } from "../hooks/useFlipBook.js";
import { useIsoLayoutEffect } from "../hooks/useIsoLayoutEffect.js";
import { formatMessage, formatPageRange } from "../locale.js";
import { themeVariables } from "../theme.js";
import { visuallyHidden } from "../styles.js";
import { FlipBookProvider } from "./FlipBookProvider.js";
import { FlipBookSidePanel } from "./FlipBookSidePanel.js";
import { FlipBookStage } from "./FlipBookStage.js";
import { FlipBookToolbar } from "./FlipBookToolbar.js";

type RootProps = Pick<
  FlipBookProps,
  | "width"
  | "height"
  | "background"
  | "theme"
  | "className"
  | "style"
  | "toolbar"
  | "renderToolbar"
  | "navigation"
  | "keyboard"
  | "aspectRatio"
  | "padding"
  | "renderLoader"
  | "renderError"
  | "renderEmpty"
>;

/**
 * The complete viewer: page turning by hand and by button, zoom, a toolbar,
 * and the optional thumbnails, bookmarks, fullscreen, download, print and share.
 *
 * ```tsx
 * <FlipBook source="/magazine.pdf" cover thumbnails bookmarks fullscreen />
 * ```
 *
 * Pass a `ref` to drive it imperatively; use `useFlipBook()` from components
 * rendered inside a `<FlipBookProvider>`.
 */
export const FlipBook = forwardRef<FlipBookController, FlipBookProps>(function FlipBook(
  props,
  ref,
) {
  const {
    width,
    height,
    background,
    theme,
    className,
    style,
    toolbar,
    renderToolbar,
    navigation,
    keyboard,
    aspectRatio,
    padding,
    renderLoader,
    renderError,
    renderEmpty,
    ...bookProps
  } = props;

  return (
    <FlipBookProvider {...bookProps}>
      <FlipBookRoot
        ref={ref}
        width={width}
        height={height}
        background={background}
        theme={theme}
        className={className}
        style={style}
        toolbar={toolbar}
        renderToolbar={renderToolbar}
        navigation={navigation}
        keyboard={keyboard}
        aspectRatio={aspectRatio}
        padding={padding}
        renderLoader={renderLoader}
        renderError={renderError}
        renderEmpty={renderEmpty}
      />
    </FlipBookProvider>
  );
});

const FlipBookRoot = forwardRef<FlipBookController, RootProps>(function FlipBookRoot(props, ref) {
  const {
    width = "100%",
    height = "80vh",
    background,
    theme,
    className,
    style,
    toolbar = true,
    renderToolbar,
    navigation = true,
    keyboard = true,
    aspectRatio,
    padding,
    renderLoader,
    renderError,
    renderEmpty,
  } = props;

  const { locale, interaction, breakpoint, fullscreen, ui: uiStore } = useFlipBookContext();
  const book = useFlipBook();
  const { state, ui, features } = book;

  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => book, [book]);

  // The Fullscreen API acts on this element.
  useIsoLayoutEffect(() => {
    fullscreen.attach(rootRef.current);
    return () => fullscreen.attach(null);
  }, [fullscreen]);

  // Narrow containers get a bottom sheet instead of a sidebar.
  const size = useElementSize(rootRef);
  const sheet = size !== null && size.width < breakpoint;
  const panelAvailable = ui.panel !== null && features[ui.panel];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!keyboard || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) {
      return;
    }
    const rtl = state.direction === "rtl";
    switch (event.key) {
      case "ArrowRight":
        if (rtl) book.previous();
        else book.next();
        break;
      case "ArrowLeft":
        if (rtl) book.next();
        else book.previous();
        break;
      case "Home":
        book.first();
        break;
      case "End":
        book.last();
        break;
      case "+":
      case "=":
        if (!interaction.zoomEnabled) return;
        book.zoomIn();
        break;
      case "-":
      case "_":
        if (!interaction.zoomEnabled) return;
        book.zoomOut();
        break;
      case "0":
        if (!interaction.zoomEnabled) return;
        book.fit();
        break;
      case "f":
      case "F":
        if (!features.fullscreen) return;
        book.toggleFullscreen();
        break;
      case "b":
      case "B":
        if (!features.bookmarks) return;
        book.toggleBookmark();
        break;
      case "/":
        if (!features.search) return;
        if (ui.panel === "search") {
          (rootRef.current?.querySelector("[data-flipbook-search-input]") as HTMLElement | null)?.focus();
        } else {
          book.openPanel("search");
        }
        break;
      case "Escape":
        // The browser handles Escape for real fullscreen; this covers an open popover, the fallback and the panel.
        if (ui.hotspot !== null) uiStore.setHotspot(null);
        else if (ui.fullscreen === "fixed") book.exitFullscreen();
        else if (ui.panel !== null) book.closePanel();
        else return;
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // Fullscreen wins over the `width` and `height` props.
  const fullscreenStyle: CSSProperties =
    ui.fullscreen === "native"
      ? { width: "100%", height: "100%" }
      : ui.fullscreen === "fixed"
        ? { position: "fixed", inset: 0, width: "auto", height: "auto", zIndex: 2147483000 }
        : {};

  const rootStyle: CSSProperties = {
    ...themeVariables(theme),
    position: "relative",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    width,
    height,
    overflow: "hidden",
    background: background ?? "var(--flipbook-background, #eef0f2)",
    ...style,
    ...fullscreenStyle,
  };

  const announcement =
    state.pageCount === 0
      ? ""
      : formatMessage(state.visiblePages.length > 1 ? locale.pagesStatus : locale.pageStatus, {
          page: formatPageRange(state.visiblePages),
          total: state.pageCount,
        });

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="flipbook"
      aria-label={locale.viewerLabel}
      tabIndex={0}
      className={className ? `flipbook-root ${className}` : "flipbook-root"}
      data-flipbook-theme={theme}
      data-flipbook-fullscreen={ui.fullscreen === "none" ? undefined : ui.fullscreen}
      onKeyDown={onKeyDown}
      style={rootStyle}
    >
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", position: "relative" }}>
        {panelAvailable && !sheet ? (
          <FlipBookSidePanel variant="sidebar" aspectRatio={aspectRatio ?? "auto"} />
        ) : null}
        <FlipBookStage
          aspectRatio={aspectRatio}
          padding={padding}
          renderLoader={renderLoader}
          renderError={renderError}
          renderEmpty={renderEmpty}
        />
        {panelAvailable && sheet ? (
          <FlipBookSidePanel variant="sheet" aspectRatio={aspectRatio ?? "auto"} />
        ) : null}
        {ui.notice ? (
          <div
            // A new key per notice makes screen readers announce a repeated message again.
            key={ui.notice.id}
            role="status"
            data-flipbook-notice=""
            style={{
              position: "absolute",
              left: "50%",
              bottom: 12,
              transform: "translateX(-50%)",
              maxWidth: "calc(100% - 24px)",
              padding: "8px 14px",
              borderRadius: 999,
              background: "rgba(20, 22, 25, 0.92)",
              color: "#fff",
              font: "13px/1.3 system-ui, sans-serif",
              pointerEvents: "none",
              zIndex: 6,
            }}
          >
            {ui.notice.text}
          </div>
        ) : null}
      </div>
      {toolbar && state.pageCount > 0
        ? renderToolbar
          ? renderToolbar({ controls: book })
          : <FlipBookToolbar navigation={navigation} />
        : null}
      <div aria-live="polite" aria-atomic="true" style={visuallyHidden}>
        {announcement}
      </div>
    </div>
  );
});
