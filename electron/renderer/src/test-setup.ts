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
