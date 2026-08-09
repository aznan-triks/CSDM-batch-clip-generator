/**
 * Unmount whatever a test rendered, before the next one renders.
 *
 * @testing-library/react only registers its own automatic cleanup when Vitest
 * runs with `globals: true`, and this project does not: tests import `describe`
 * and `it` explicitly. Without this file, two renders of the same component
 * coexist in the document and every `getBy*` query fails as ambiguous.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

/**
 * jsdom has no layout engine: `ResizeObserver` does not exist, and every
 * element's `clientWidth` reads 0. `SectionList` (3.2.4) measures its own
 * pane width through both to size react-grid-layout, so without these stubs
 * every tab that renders it (CaptureTab, VideoTab, SettingsTab, ...) would
 * mount an empty grid in every test that touches them. A single global stub
 * beats repeating it in each consumer's test file.
 */
globalThis.ResizeObserver ??= class {
  observe() {
    /* jsdom has no layout; width comes from the clientWidth stub below */
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1200 });
