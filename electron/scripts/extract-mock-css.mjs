/**
 * Extracts the approved mock's <style> block into a stylesheet the renderer
 * imports directly.
 *
 * WHY THIS EXISTS: four restyle passes hand-copied the mock into forty
 * component stylesheets. Every file drifted a little and the total drifted a
 * lot. The approved design is one file; so is the stylesheet that ships.
 *
 * The generated file is committed (Vite must resolve it at build time without
 * a pre-step) and a test re-runs this extraction to prove the committed copy
 * still matches. Never edit the generated file by hand.
 *
 * Run: npm run --prefix electron build:mock-css
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const MOCK_HTML_PATH = join(
  HERE,
  "..",
  "..",
  "docs",
  "ui-restyle-mockups",
  "mockup-v12-hologlass.html",
);
export const MOCK_CSS_PATH = join(HERE, "..", "renderer", "src", "theme", "mock-v12.css");

export const BANNER = `/* GENERATED FILE -- DO NOT EDIT.
 *
 * The <style> block of docs/ui-restyle-mockups/mockup-v12-hologlass.html,
 * verbatim. This IS the approved design; where this file and a component
 * stylesheet disagree, this one is right.
 *
 * Regenerate: npm run --prefix electron build:mock-css
 * The drift lock lives in src/theme/__tests__/mock-v12.test.ts.
 */
`;

/**
 * Returns the mock's stylesheet: the banner, then the <style> body verbatim.
 * Fails loudly -- a silently empty stylesheet would ship an unstyled window.
 */
export function extractMockCss(html) {
  const match = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!match) throw new Error("no <style> block found in the mock");
  const css = match[1].trim();
  if (css.length === 0) throw new Error("the mock's <style> block is empty");
  return `${BANNER}\n${css}\n`;
}

// Only writes when run directly, so the test can import the function alone.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(MOCK_CSS_PATH, extractMockCss(readFileSync(MOCK_HTML_PATH, "utf8")), "utf8");
  console.error(`wrote ${MOCK_CSS_PATH}`);
}
