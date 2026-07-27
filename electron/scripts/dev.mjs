/**
 * Development launcher: start Vite, then Electron pointed at it.
 *
 * Vite is started through its JS API rather than a second npm process, so no
 * `concurrently` / `wait-on` dependency is needed and Electron only launches
 * once the server is actually listening -- otherwise the window opens on a
 * connection refused and stays blank.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electron from "electron";
import { createServer } from "vite";

const ELECTRON_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const server = await createServer({ configFile: path.join(ELECTRON_DIR, "vite.config.ts") });
await server.listen();

const url = server.resolvedUrls?.local?.[0];
if (!url) {
  await server.close();
  throw new Error("Vite started but reported no local URL");
}
server.printUrls();

const child = spawn(electron, [ELECTRON_DIR], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

// Closing the window ends the dev session; leaving Vite running would hold the
// port and the terminal.
child.on("close", async () => {
  await server.close();
  process.exit(0);
});
