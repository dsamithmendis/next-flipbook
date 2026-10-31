"use client";

import { FlipBook, type FlipBookController } from "next-flipbook";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Nav } from "../Nav";
import { imagePages } from "../data";

type Content = "images" | "pdf";
type Choice<T extends string> = readonly T[];

interface Settings {
  content: Content;
  mode: "auto" | "single" | "double";
  direction: "ltr" | "rtl";
  cover: boolean;
  duration: number;
  shadow: boolean;
  shadowIntensity: number;
  reducedMotion: "auto" | "on" | "off";
  theme: "default" | "light" | "dark";
  toolbar: boolean;
  thumbnails: boolean;
  bookmarks: boolean;
  search: boolean;
  outline: boolean;
  fullscreen: boolean;
  download: boolean;
  print: boolean;
  share: boolean;
  dragToTurn: boolean;
  zoom: boolean;
  wheelZoom: "ctrl" | "always" | "never";
}

const DEFAULTS: Settings = {
  content: "images",
  mode: "auto",
  direction: "ltr",
  cover: true,
  duration: 700,
  shadow: true,
  shadowIntensity: 0.5,
  reducedMotion: "auto",
  theme: "default",
  toolbar: true,
  thumbnails: true,
  bookmarks: true,
  search: false,
  outline: false,
  fullscreen: true,
  download: false,
  print: false,
  share: false,
  dragToTurn: true,
  zoom: true,
  wheelZoom: "ctrl",
};

/** What the library's own defaults are, so the code shown lists only what was changed. */
const LIBRARY_DEFAULTS = {
  mode: "auto",
  direction: "ltr",
  cover: false,
  duration: 700,
  shadow: true,
  shadowIntensity: 0.5,
  reducedMotion: "auto",
  toolbar: true,
  thumbnails: false,
  bookmarks: false,
  search: false,
  outline: false,
  fullscreen: true,
  download: false,
  print: false,
  share: false,
  dragToTurn: true,
  zoom: true,
  wheelZoom: "ctrl",
} as const;

const SOURCES: Record<Content, { source?: string; pages?: typeof imagePages; code: string }> = {
  images: { pages: imagePages, code: "pages={pages}" },
  pdf: { source: "/guide.pdf", code: 'source="/guide.pdf"' },
};

function toProps(settings: Settings) {
  return {
    mode: settings.mode,
    direction: settings.direction,
    cover: settings.cover,
    duration: settings.duration,
    shadow: settings.shadow,
    shadowIntensity: settings.shadowIntensity,
    reducedMotion: settings.reducedMotion === "auto" ? ("auto" as const) : settings.reducedMotion === "on",
    theme: settings.theme === "default" ? undefined : settings.theme,
    toolbar: settings.toolbar,
    thumbnails: settings.thumbnails,
    bookmarks: settings.bookmarks,
    // Search and contents read the PDF's text and outline, which the image pages do not have.
    search: settings.content === "pdf" && settings.search,
    outline: settings.content === "pdf" && settings.outline,
    fullscreen: settings.fullscreen,
    download: settings.download,
    print: settings.print,
    share: settings.share,
    dragToTurn: settings.dragToTurn,
    zoom: settings.zoom,
    wheelZoom: settings.wheelZoom === "always" ? true : settings.wheelZoom === "never" ? false : ("ctrl" as const),
  };
}

/** The JSX that gives the viewer as it is now: only the props that differ from the defaults. */
function toCode(settings: Settings): string {
  const lines: string[] = [SOURCES[settings.content].code];
  const set = (name: string, value: string | number | boolean, fallback: string | number | boolean) => {
    if (value === fallback) return;
    lines.push(value === true ? name : typeof value === "string" ? `${name}="${value}"` : `${name}={${String(value)}}`);
  };
  const props = toProps(settings);
  for (const key of ["mode", "direction"] as const) set(key, props[key], LIBRARY_DEFAULTS[key]);
  set("cover", props.cover, LIBRARY_DEFAULTS.cover);
  set("duration", props.duration, LIBRARY_DEFAULTS.duration);
  set("shadow", props.shadow, LIBRARY_DEFAULTS.shadow);
  set("shadowIntensity", props.shadowIntensity, LIBRARY_DEFAULTS.shadowIntensity);
  if (settings.reducedMotion !== "auto") lines.push(`reducedMotion={${settings.reducedMotion === "on"}}`);
  if (props.theme) lines.push(`theme="${props.theme}"`);
  for (const key of ["toolbar", "fullscreen", "dragToTurn", "zoom"] as const) {
    if (props[key] !== LIBRARY_DEFAULTS[key]) lines.push(`${key}={${String(props[key])}}`);
  }
  for (const key of ["thumbnails", "bookmarks", "search", "outline", "download", "print", "share"] as const) {
    set(key, props[key], LIBRARY_DEFAULTS[key]);
  }
  if (settings.wheelZoom !== "ctrl") lines.push(`wheelZoom={${settings.wheelZoom === "always"}}`);
  if (settings.content === "pdf") lines.push('pdf={{ workerSrc: "/pdf.worker.min.mjs" }}');
  return `<FlipBook\n${lines.map((line) => `  ${line}`).join("\n")}\n/>`;
}

const fieldset = { border: "1px solid var(--line)", borderRadius: 8, margin: 0, padding: "8px 12px 12px", minWidth: 0 } as const;
const legend = { padding: "0 6px", color: "var(--muted)", fontSize: 13 } as const;
const row = { display: "flex", alignItems: "center", gap: 8, margin: "6px 0", fontSize: 14 } as const;

export default function Playground() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [log, setLog] = useState<string[]>([]);
  const ref = useRef<FlipBookController>(null);
  const [copied, setCopied] = useState(false);

  const change = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setSettings((previous) => ({ ...previous, [key]: value }));
  const note = (message: string): void => setLog((previous) => [message, ...previous].slice(0, 8));

  const props = useMemo(() => toProps(settings), [settings]);
  const code = useMemo(() => toCode(settings), [settings]);
  const content = SOURCES[settings.content];

  const toggle = (key: keyof Settings, label: string, disabled = false): ReactNode => (
    <label style={{ ...row, opacity: disabled ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={Boolean(settings[key])}
        disabled={disabled}
        onChange={(event) => change(key, event.target.checked as never)}
      />
      {label}
    </label>
  );
  const choose = <K extends keyof Settings>(key: K, label: string, options: Choice<Extract<Settings[K], string>>): ReactNode => (
    <label style={row}>
      <span style={{ minWidth: 92 }}>{label}</span>
      <select value={String(settings[key])} onChange={(event) => change(key, event.target.value as Settings[K])}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <main style={{ maxWidth: 1360 }}>
      <h1>Playground</h1>
      <p className="lede">
        Change the props and the book changes with them. The code underneath is what gives the viewer as it is now.
        Search and Contents need the PDF.
      </p>
      <Nav />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, alignItems: "start" }}>
        <form
          aria-label="Props"
          onSubmit={(event) => event.preventDefault()}
          style={{ display: "grid", gap: 12, font: "14px/1.4 system-ui, sans-serif", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          <fieldset style={fieldset}>
            <legend style={legend}>Content</legend>
            {choose("content", "Show", ["images", "pdf"] as const)}
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>Layout</legend>
            {choose("mode", "mode", ["auto", "single", "double"] as const)}
            {choose("direction", "direction", ["ltr", "rtl"] as const)}
            {choose("theme", "theme", ["default", "light", "dark"] as const)}
            {toggle("cover", "cover")}
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>Page turn</legend>
            <label style={row}>
              <span style={{ minWidth: 92 }}>duration</span>
              <input
                type="range"
                min={100}
                max={2000}
                step={50}
                value={settings.duration}
                aria-label="duration"
                onChange={(event) => change("duration", Number(event.target.value))}
              />
              <output>{settings.duration} ms</output>
            </label>
            <label style={row}>
              <span style={{ minWidth: 92 }}>shadow</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.shadowIntensity}
                aria-label="shadow intensity"
                disabled={!settings.shadow}
                onChange={(event) => change("shadowIntensity", Number(event.target.value))}
              />
              <output>{settings.shadowIntensity.toFixed(1)}</output>
            </label>
            {toggle("shadow", "shadow")}
            {choose("reducedMotion", "reduced motion", ["auto", "on", "off"] as const)}
            {toggle("dragToTurn", "dragToTurn")}
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>Zoom</legend>
            {toggle("zoom", "zoom")}
            {choose("wheelZoom", "wheelZoom", ["ctrl", "always", "never"] as const)}
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>Toolbar</legend>
            {toggle("toolbar", "toolbar")}
            {toggle("thumbnails", "thumbnails")}
            {toggle("bookmarks", "bookmarks")}
            {toggle("search", "search", settings.content !== "pdf")}
            {toggle("outline", "outline", settings.content !== "pdf")}
            {toggle("fullscreen", "fullscreen")}
            {toggle("download", "download")}
            {toggle("print", "print")}
            {toggle("share", "share")}
          </fieldset>

          <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
            <button type="button" onClick={() => setSettings(DEFAULTS)}>
              Reset
            </button>
          </div>
        </form>

        <div style={{ minWidth: 0 }}>
          <FlipBook
            // A different document is a different book.
            key={settings.content}
            ref={ref}
            source={content.source}
            pages={content.pages}
            pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
            height="62vh"
            {...props}
            onPageChange={(page) => note(`page ${page}`)}
            onPageTurnStart={(event) => note(`turn ${event.fromPage} to ${event.toPage}`)}
            onZoomChange={(zoom) => note(`zoom ${zoom.toFixed(2)}`)}
            onError={(error) => note(`error ${error.code}`)}
          />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
            <section aria-label="Code">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 14, font: "600 14px system-ui, sans-serif" }}>Code</h2>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(code).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre
                data-testid="playground-code"
                style={{
                  margin: 0,
                  padding: 12,
                  overflow: "auto",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {code}
              </pre>
            </section>
            <section aria-label="Events">
              <h2 style={{ margin: "0 0 4px", font: "600 14px system-ui, sans-serif" }}>Events</h2>
              <ol
                data-testid="playground-events"
                style={{
                  margin: 0,
                  padding: "8px 12px 8px 28px",
                  minHeight: 120,
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {log.map((entry, index) => (
                  <li key={`${entry}-${log.length - index}`}>{entry}</li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
