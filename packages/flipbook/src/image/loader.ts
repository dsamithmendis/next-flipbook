import { FlipBookRuntimeError } from "../core/errors.js";

export interface LoadedImage {
  src: string;
  width: number;
  height: number;
}

/**
 * Loads and decodes images, de-duplicating requests. Browser globals are only
 * touched when `load` runs, so constructing a loader is safe during SSR.
 */
export class ImageLoader {
  private readonly cache = new Map<string, Promise<LoadedImage>>();
  private readonly inflight = new Set<HTMLImageElement>();

  load(src: string): Promise<LoadedImage> {
    const cached = this.cache.get(src);
    if (cached) return cached;

    const promise = new Promise<LoadedImage>((resolve, reject) => {
      if (typeof Image === "undefined") {
        reject(
          new FlipBookRuntimeError(
            "UNSUPPORTED_ENVIRONMENT",
            "Images can only be loaded in a browser.",
          ),
        );
        return;
      }
      const image = new Image();
      this.inflight.add(image);

      const release = (): void => {
        image.onload = null;
        image.onerror = null;
        this.inflight.delete(image);
      };

      image.onerror = () => {
        release();
        reject(new FlipBookRuntimeError("IMAGE_LOAD_FAILED", `Failed to load image: ${src}`));
      };
      image.onload = () => {
        const finish = (): void => {
          release();
          resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
        };
        // decode() avoids a first-paint hitch; where it is missing or rejects
        // the image still works, so both outcomes finish normally.
        if (typeof image.decode === "function") image.decode().then(finish, finish);
        else finish();
      };
      image.decoding = "async";
      image.src = src;
    });

    this.cache.set(src, promise);
    // A failed load is not cached, so a later attempt can retry.
    promise.catch(() => {
      if (this.cache.get(src) === promise) this.cache.delete(src);
    });
    return promise;
  }

  /** Fire-and-forget warm-up. Failures surface when the page is actually shown. */
  preload(sources: Iterable<string>): void {
    for (const src of sources) this.load(src).catch(() => undefined);
  }

  /** Aborts in-flight requests and empties the cache. The loader stays usable. */
  dispose(): void {
    for (const image of this.inflight) {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    }
    this.inflight.clear();
    this.cache.clear();
  }
}
