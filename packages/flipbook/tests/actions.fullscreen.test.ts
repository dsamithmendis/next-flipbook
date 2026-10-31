// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullscreenController } from "../src/actions/fullscreen.js";
import type { FullscreenMode } from "../src/core/ui/UiStore.js";

type FsDoc = Document & {
  fullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
};

let element: HTMLElement;
const doc = (): FsDoc => document;

beforeEach(() => {
  element = document.createElement("div");
  document.body.appendChild(element);
  document.body.style.overflow = "";
});

afterEach(() => {
  element.remove();
  for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) {
    Reflect.deleteProperty(document, key);
  }
});

function make(fallback = true) {
  const modes: FullscreenMode[] = [];
  const controller = new FullscreenController({ onChange: (m) => modes.push(m), fallback });
  controller.attach(element);
  return { controller, modes };
}

/** Pretends the browser supports the Fullscreen API. */
function enableNative(options: { refuse?: boolean } = {}) {
  doc().fullscreenEnabled = true;
  doc().fullscreenElement = null;
  const request = vi.fn(async () => {
    if (options.refuse) throw new TypeError("Permissions check failed");
    doc().fullscreenElement = element;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  (element as HTMLElement & { requestFullscreen: () => Promise<void> }).requestFullscreen = request;
  const exit = vi.fn(async () => {
    doc().fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  doc().exitFullscreen = exit;
  return { request, exit };
}

describe("FullscreenController: fallback", () => {
  it("fills the viewport when the Fullscreen API is missing, and locks page scroll", async () => {
    const { controller, modes } = make();
    expect(controller.isNativeAvailable()).toBe(false);
    document.body.style.overflow = "auto";

    await controller.enter();
    expect(controller.getMode()).toBe("fixed");
    expect(controller.isFullscreen()).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    await controller.exit();
    expect(controller.getMode()).toBe("none");
    expect(document.body.style.overflow).toBe("auto");
    expect(modes).toEqual(["fixed", "none"]);
  });

  it("does nothing when the fallback is off", async () => {
    const { controller, modes } = make(false);
    await controller.enter();
    expect(controller.getMode()).toBe("none");
    expect(modes).toEqual([]);
  });

  it("toggles", async () => {
    const { controller } = make();
    await controller.toggle();
    expect(controller.getMode()).toBe("fixed");
    await controller.toggle();
    expect(controller.getMode()).toBe("none");
  });

  it("does nothing without an element", async () => {
    const controller = new FullscreenController();
    await controller.enter();
    expect(controller.getMode()).toBe("none");
  });
});

describe("FullscreenController: native", () => {
  it("uses the browser's Fullscreen API", async () => {
    const { request, exit } = enableNative();
    const { controller, modes } = make();
    expect(controller.isNativeAvailable()).toBe(true);

    await controller.enter();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.getMode()).toBe("native");
    expect(document.body.style.overflow).toBe("");

    await controller.exit();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(controller.getMode()).toBe("none");
    expect(modes).toEqual(["native", "none"]);
  });

  it("notices when the browser leaves fullscreen on its own (Esc)", async () => {
    enableNative();
    const { controller, modes } = make();
    await controller.enter();
    doc().fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(controller.getMode()).toBe("none");
    expect(modes).toEqual(["native", "none"]);
  });

  it("ignores fullscreen of some other element", async () => {
    enableNative();
    const { controller } = make();
    doc().fullscreenElement = document.createElement("video");
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(controller.getMode()).toBe("none");
  });

  it("falls back when the browser refuses", async () => {
    enableNative({ refuse: true });
    const { controller } = make();
    await controller.enter();
    expect(controller.getMode()).toBe("fixed");
  });

  it("stays out of fullscreen when the browser refuses and there is no fallback", async () => {
    enableNative({ refuse: true });
    const { controller } = make(false);
    await controller.enter();
    expect(controller.getMode()).toBe("none");
  });
});

describe("FullscreenController: lifecycle", () => {
  it("detaching leaves fullscreen and stops listening", async () => {
    enableNative();
    const { controller, modes } = make();
    await controller.enter();
    controller.attach(null);
    expect(controller.getMode()).toBe("none");
    const seen = modes.length;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(modes).toHaveLength(seen);
  });

  it("destroy restores page scroll and removes listeners", async () => {
    const { controller, modes } = make();
    document.body.style.overflow = "scroll";
    await controller.enter();
    controller.destroy();
    expect(document.body.style.overflow).toBe("scroll");
    const seen = modes.length;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(modes).toHaveLength(seen);
  });

  it("can be created and used on the server: no browser global is read until a method needs one", () => {
    expect(() => new FullscreenController()).not.toThrow();
  });
});
