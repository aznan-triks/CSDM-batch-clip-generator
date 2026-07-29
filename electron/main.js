// Electron main process: spawns `python -m csdm.bridge` and relays the JSON
// pipe to the renderer. This is a skeleton -- raw lines only, no UI polish
// (chantier 3/4).
"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Where the Python engine lives.
 *
 * Unpackaged, that is simply the folder above this one. Packaged, `__dirname`
 * is inside the app archive, so the same join would point at the archive's own
 * parent and `-m csdm.bridge` would resolve nothing: the window would open and
 * the engine would never start. So the packaged build walks up from the
 * executable looking for the `csdm/bridge` package, which is what keeps a
 * portable build working as long as it sits somewhere under the project.
 *
 * CSDM_REPO_ROOT overrides both, for a build kept anywhere else.
 */
function resolveRepoRoot() {
  if (process.env.CSDM_REPO_ROOT) {
    return process.env.CSDM_REPO_ROOT;
  }
  const beside = path.join(__dirname, "..");
  if (!app.isPackaged) {
    return beside;
  }
  let dir = path.dirname(process.execPath);
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(dir, "csdm", "bridge"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the drive root
    dir = parent;
  }
  return beside;
}

// Window geometry. Defaults mirror DEFAULT_CONFIG's ui_window_w / ui_window_h;
// the minimum is D24 -- below it the two columns stop being usable.
const WINDOW_DEFAULT_W = 1600;
const WINDOW_DEFAULT_H = 900;
const WINDOW_MIN_W = 900;
const WINDOW_MIN_H = 640;

let mainWindow = null;
let child = null;
let stdoutBuffer = ""; // holds a line fragment carried over between two stdout chunks

/**
 * Find a Python interpreter able to run this repo.
 *
 * Priority: an explicit override (CSDM_PYTHON_PATH), then the interpreters
 * most likely to be on a Windows dev machine, then the generic names on
 * PATH. Each candidate is probed with `--version` so a name that doesn't
 * resolve to a real interpreter is skipped instead of failing later inside
 * spawn().
 */
function resolvePythonPath() {
  const candidates = [];
  if (process.env.CSDM_PYTHON_PATH) {
    candidates.push(process.env.CSDM_PYTHON_PATH);
  }
  if (process.platform === "win32") {
    candidates.push("py");
  }
  candidates.push("python", "python3");

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { windowsHide: true });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  // Nothing probed successfully; fall back to "python" and let spawn() report
  // the real error rather than silently doing nothing.
  return "python";
}

function sendToRenderer(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("bridge:message", message);
  }
}

function startEngine() {
  const pythonPath = resolvePythonPath();
  const args = pythonPath === "py" ? ["-3", "-m", "csdm.bridge"] : ["-m", "csdm.bridge"];

  child = spawn(pythonPath, args, {
    cwd: resolveRepoRoot(), // `-m csdm.bridge` only resolves from the repo root
    windowsHide: true, // Node's equivalent of CREATE_NO_WINDOW (D19)
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    // A JSON line can arrive split across two chunks. Keep the trailing
    // fragment (no trailing "\n" yet) and prepend it to the next chunk
    // instead of parsing it prematurely.
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop(); // last element has no trailing newline yet

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        sendToRenderer(JSON.parse(line));
      } catch (err) {
        // A malformed line must never crash the shell; surface it as a log.
        sendToRenderer({ type: "log", level: "err", message: `unreadable line from engine: ${err.message}` });
      }
    }
  });

  // The child's stderr is diagnostics only -- Python tracebacks, HLAE/cs2
  // noise that leaked past capture, etc. It is never protocol and must never
  // be parsed as JSON.
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    console.error(`[python] ${chunk}`);
  });

  child.on("error", (err) => {
    sendToRenderer({ type: "child_error", error: err.message });
  });

  child.on("exit", (code, signal) => {
    sendToRenderer({ type: "child_exit", code, signal });
    child = null;
  });
}

function killEngine() {
  if (child && !child.killed) {
    child.kill();
  }
  child = null;
}

function sendCommandToEngine(command) {
  if (child && child.stdin.writable) {
    child.stdin.write(JSON.stringify(command) + "\n");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_DEFAULT_W,
    height: WINDOW_DEFAULT_H,
    minWidth: WINDOW_MIN_W,
    minHeight: WINDOW_MIN_H,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // In development `scripts/dev.mjs` sets VITE_DEV_SERVER_URL so the window
  // gets hot reload; in production the built bundle is loaded from disk, with
  // no server and no network involved.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer", "dist", "index.html"));
  }
}

ipcMain.on("bridge:send", (_event, command) => {
  sendCommandToEngine(command);
});

// The renderer has no filesystem access at all (contextIsolation), so the
// folder picker has to live here. It returns a path or null, nothing else.
ipcMain.handle("bridge:pick-path", async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: [options && options.file ? "openFile" : "openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Same reasoning as bridge:pick-path -- the renderer has no filesystem
// access, so the save-as dialog (used by tags export) has to live here too.
ipcMain.handle("bridge:pick-save-path", async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: (options && options.defaultName) || "tags-export.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

app.whenReady().then(() => {
  startEngine();
  createWindow();
});

// D19: no orphan is allowed to keep driving CS2. Both exit paths on
// Windows/Linux/macOS must kill the child.
app.on("window-all-closed", () => {
  killEngine();
  app.quit();
});

app.on("before-quit", () => {
  killEngine();
});
