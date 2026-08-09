/**
 * Guard: react-grid-layout's own class names must not be owned by the mock.
 * The mock occupies the global class namespace (`shell`, `spark`, `wide`, ...);
 * a library class colliding with one of its rules would inherit layout the
 * mock never meant for it (context_guide §10).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MOCK_CSS = path.resolve(__dirname, "../../theme/mock-v12.css");

/** Every class react-grid-layout writes onto the DOM. */
const RGL_CLASSES = [
  "react-grid-layout",
  "react-grid-item",
  "react-grid-placeholder",
  "react-resizable",
  "react-resizable-handle",
  "react-draggable",
  "react-draggable-dragging",
  "resizing",
  "cssTransforms",
];

describe("react-grid-layout namespace", () => {
  const css = readFileSync(MOCK_CSS, "utf8");

  it.each(RGL_CLASSES)("the mock does not own .%s", (name) => {
    const owned = new RegExp(`\\.${name}\\b`).test(css);
    expect(owned).toBe(false);
  });
});
