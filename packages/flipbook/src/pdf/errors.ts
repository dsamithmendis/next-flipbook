import {
  FlipBookRuntimeError,
  type FlipBookError,
  type FlipBookErrorCode,
} from "../core/errors.js";

/** Thrown when work is dropped on purpose (page scrolled away, viewer unmounted). */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

const CANCELLATION_NAMES = new Set([
  "CancelledError",
  "AbortException",
  "RenderingCancelledException",
]);

/** True for deliberate cancellations, which are never reported to the app. */
export function isCancellation(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null) return false;
  return CANCELLATION_NAMES.has((reason as { name?: unknown }).name as string);
}

const WORKER_HINT =
  "Check `pdf.workerSrc`, your Content-Security-Policy, and that the worker file is reachable.";

/** Translates PDF.js and fetch failures into structured `FlipBookError`s. */
export function mapPdfError(
  reason: unknown,
  fallback: FlipBookErrorCode = "PDF_LOAD_FAILED",
): FlipBookError {
  const name = (reason as { name?: unknown } | null)?.name;
  const rawMessage = (reason as { message?: unknown } | null)?.message;
  const message = typeof rawMessage === "string" ? rawMessage : "";

  if (reason instanceof FlipBookRuntimeError) return reason;

  if (name === "PasswordException") {
    return { code: "PASSWORD_REQUIRED", message: "This PDF needs a valid password.", cause: reason };
  }
  if (name === "InvalidPDFException") {
    return { code: "INVALID_PDF", message: "The file is not a valid PDF.", cause: reason };
  }
  if (name === "ResponseException" || name === "MissingPDFException") {
    const status = (reason as { status?: number }).status;
    const missing = (reason as { missing?: boolean }).missing || status === 404;
    return missing
      ? { code: "PDF_NOT_FOUND", message: "The PDF could not be found (404).", cause: reason }
      : {
          code: "NETWORK_ERROR",
          message: `The PDF request failed${status ? ` with status ${status}` : ""}.`,
          cause: reason,
        };
  }
  if (name === "UnexpectedResponseException") {
    return { code: "NETWORK_ERROR", message: "The server returned an unexpected response.", cause: reason };
  }
  if (/worker/i.test(message) || /dynamically imported module/i.test(message)) {
    return { code: "PDF_WORKER_FAILED", message: `The PDF worker failed to start. ${WORKER_HINT}`, cause: reason };
  }
  if (reason instanceof TypeError && /fetch|network|load failed/i.test(message)) {
    return {
      code: "NETWORK_ERROR",
      message:
        "The PDF could not be fetched. The network is unavailable, or the server does not allow this origin (CORS).",
      cause: reason,
    };
  }
  return {
    code: fallback,
    message: message || "The PDF could not be loaded.",
    cause: reason,
  };
}
