import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.mjs$/,
  // One window at a time: they share port 5273 (strictPort in vite.config.ts).
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 60000,
});
