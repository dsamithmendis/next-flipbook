/** Machine-readable reasons the viewer can fail. */
export type FlipBookErrorCode =
  | "IMAGE_LOAD_FAILED"
  | "UNSUPPORTED_ENVIRONMENT"
  | "INVALID_ARGUMENT"
  /** The file is not a PDF, or is corrupt. */
  | "INVALID_PDF"
  /** The server answered 404 for the PDF URL. */
  | "PDF_NOT_FOUND"
  /** The request failed: offline, blocked by CORS, or a server error. */
  | "NETWORK_ERROR"
  /** The PDF is encrypted and no valid password was supplied. */
  | "PASSWORD_REQUIRED"
  /** The PDF.js worker could not start. Usually a `workerSrc` or CSP problem. */
  | "PDF_WORKER_FAILED"
  | "PDF_LOAD_FAILED"
  | "PAGE_RENDER_FAILED"
  /** Printing could not start, or there was nothing printable. */
  | "PRINT_FAILED"
  /** The file could not be handed to the browser as a download. */
  | "DOWNLOAD_FAILED"
  /** The `source` is not a URL, Blob, File, ArrayBuffer or Uint8Array. */
  | "UNSUPPORTED_SOURCE";

/** Structured error passed to `onError` and to custom error renderers. */
export interface FlipBookError {
  code: FlipBookErrorCode;
  message: string;
  cause?: unknown;
  /** 1-based page number, when the error belongs to one page. */
  page?: number;
}

/** Concrete `Error` used internally so stack traces survive. */
export class FlipBookRuntimeError extends Error implements FlipBookError {
  readonly code: FlipBookErrorCode;
  readonly page?: number;

  constructor(
    code: FlipBookErrorCode,
    message: string,
    details: { cause?: unknown; page?: number } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "FlipBookError";
    this.code = code;
    if (details.page !== undefined) this.page = details.page;
  }
}

function isFlipBookError(value: unknown): value is FlipBookError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

/** Normalises anything thrown into a `FlipBookError`. */
export function toFlipBookError(
  value: unknown,
  fallback: { code: FlipBookErrorCode; message: string; page?: number },
): FlipBookError {
  if (isFlipBookError(value)) return value;
  return {
    code: fallback.code,
    message: fallback.message,
    cause: value,
    ...(fallback.page !== undefined ? { page: fallback.page } : {}),
  };
}
