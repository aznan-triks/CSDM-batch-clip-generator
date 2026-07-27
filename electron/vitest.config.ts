import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that file sets `root` to the
// renderer directory for the app build, which would make Vitest look for
// tests under renderer/renderer instead of renderer/src.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["renderer/src/**/*.test.ts"],
  },
});
