/** Schemes a PDF may link to. Anything else (javascript:, data:, file:, ...) is dropped. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Returns the address if it is safe to follow from a document, otherwise
 * null. Relative addresses are rejected: a PDF has no base to resolve them against.
 */
export function safeUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
