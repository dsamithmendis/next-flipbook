// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadSource, filenameFor, revokePendingDownloads } from "../src/actions/download.js";
import { shareLink } from "../src/actions/share.js";

interface Clicked {
  href: string;
  download: string;
  target: string;
  rel: string;
}

let clicked: Clicked[];
let created: Blob[];
let revoked: string[];

beforeEach(() => {
  clicked = [];
  created = [];
  revoked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({
      href: this.href,
      download: this.getAttribute("download") ?? "",
      target: this.target,
      rel: this.rel,
    });
  });
  let counter = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        counter += 1;
        return `blob:test/${counter}`;
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    }),
  );
});

afterEach(() => {
  revokePendingDownloads();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("filenameFor", () => {
  it("prefers an explicit name, then a File's name, then the URL, then a default", () => {
    expect(filenameFor("/a/b.pdf", "mine.pdf")).toBe("mine.pdf");
    expect(filenameFor(new File([new Uint8Array(1)], "report.pdf"))).toBe("report.pdf");
    expect(filenameFor("/files/Annual%20Report.pdf?x=1")).toBe("Annual Report.pdf");
    expect(filenameFor("/download?id=3")).toBe("document.pdf");
    expect(filenameFor(new Uint8Array(1))).toBe("document.pdf");
  });
});

describe("downloadSource", () => {
  it("downloads a same-origin URL directly", async () => {
    await downloadSource("/docs/menu.pdf");
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatchObject({ download: "menu.pdf", rel: "noopener" });
    expect(clicked[0]?.href).toBe(`${location.origin}/docs/menu.pdf`);
    expect(clicked[0]?.target).toBe("");
  });

  it("opens a cross-origin URL in a new tab instead of navigating away", async () => {
    await downloadSource("https://other.example/menu.pdf");
    expect(clicked[0]).toMatchObject({ target: "_blank", download: "", rel: "noopener" });
  });

  it("saves a Blob through an object URL, then revokes it", async () => {
    vi.useFakeTimers();
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    await downloadSource(blob, { filename: "saved.pdf" });
    expect(created).toEqual([blob]);
    expect(clicked[0]).toMatchObject({ href: "blob:test/1", download: "saved.pdf" });
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(31_000);
    expect(revoked).toEqual(["blob:test/1"]);
  });

  it("wraps an ArrayBuffer and a Uint8Array as a PDF blob", async () => {
    await downloadSource(new Uint8Array([1, 2, 3]));
    await downloadSource(new Uint8Array([4, 5]).buffer);
    expect(created.map((b) => b.type)).toEqual(["application/pdf", "application/pdf"]);
    expect(created.map((b) => b.size)).toEqual([3, 2]);
  });

  it("revokePendingDownloads releases object URLs immediately and clears the timers", async () => {
    vi.useFakeTimers();
    await downloadSource(new Blob(["x"]));
    revokePendingDownloads();
    expect(revoked).toEqual(["blob:test/1"]);
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual(["blob:test/1"]);
  });

  it("rejects a source it cannot save", async () => {
    await expect(downloadSource(42 as never)).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });

  it("leaves no anchor behind in the document", async () => {
    await downloadSource("/a.pdf");
    expect(document.querySelectorAll("a").length).toBe(0);
  });
});

describe("shareLink", () => {
  const data = { url: "https://example.test/book", title: "Book" };

  it("uses the system share sheet when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { share })).toBe("shared");
    expect(share).toHaveBeenCalledWith(data);
  });

  it("treats closing the share sheet as cancelled, not as a failure to recover from", async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" }));
    const writeText = vi.fn();
    expect(await shareLink(data, { share, clipboard: { writeText } })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link when sharing fails or is not allowed for this data", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const failing = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    expect(await shareLink(data, { share: failing, clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);

    const refused = { share: vi.fn(), canShare: () => false, clipboard: { writeText } };
    expect(await shareLink(data, refused)).toBe("copied");
    expect(refused.share).not.toHaveBeenCalled();
  });

  it("copies when there is no share API at all", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { clipboard: { writeText } })).toBe("copied");
  });

  it("falls back to the legacy copy command when the clipboard API is blocked", async () => {
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    expect(await shareLink(data, { clipboard: { writeText } })).toBe("copied");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelectorAll("textarea").length).toBe(0);
  });

  it("reports failure when nothing works", async () => {
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    expect(await shareLink(data, {})).toBe("failed");
  });
});
