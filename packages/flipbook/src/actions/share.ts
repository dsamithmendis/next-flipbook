export interface ShareData {
  url: string;
  title?: string;
  text?: string;
}

/** What happened. `cancelled` is the reader closing the share sheet, which is not an error. */
export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Shares a link: the system share sheet where there is one (phones, some
 * desktops), otherwise the link goes to the clipboard.
 */
export async function shareLink(
  data: ShareData,
  navigatorLike: ShareNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<ShareResult> {
  if (navigatorLike?.share && (navigatorLike.canShare?.(data) ?? true)) {
    try {
      await navigatorLike.share(data);
      return "shared";
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") return "cancelled";
      // Any other failure: fall back to copying.
    }
  }
  try {
    if (navigatorLike?.clipboard) {
      await navigatorLike.clipboard.writeText(data.url);
      return "copied";
    }
  } catch {
    // Permission denied or insecure context: try the legacy path.
  }
  return legacyCopy(data.url) ? "copied" : "failed";
}
