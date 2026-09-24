/**
 * The CSS half of the motion gate (`<html data-motion>`, mock-bridge.css) and
 * the live reduced-motion watch must hold from the moment the engine loads --
 * not only once some component happens to subscribe. The only subscriber is
 * the backdrop, which returns early when it gets no 2D context.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete document.documentElement.dataset.motion;
});

describe("the motion gate is in force from module load", () => {
  it("stamps <html data-motion> without any subscriber", async () => {
    delete document.documentElement.dataset.motion;
    vi.resetModules();
    await import("../engine");
    expect(document.documentElement.dataset.motion).toBe("full");
  });

  it("follows a live reduced-motion change without any subscriber", async () => {
    let changeHandler: (() => void) | undefined;
    let matches = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, h: () => void) => {
        changeHandler = h;
      },
      removeEventListener: () => {},
    }));
    vi.resetModules();
    await import("../engine");
    matches = true;
    changeHandler!();
    expect(document.documentElement.dataset.motion).toBe("none");
  });
});
