// Electron main process: spawns `python -m csdm.bridge` and relays the JSON
// pipe to the renderer. This is a skeleton -- raw lines only, no UI polish
// (chantier 3/4).
"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  buildTreeKillArgs,
  engineIsBusy,
  noteEngineState,
  resetEngineState,
} = require("./lifecycle");

/**
 * Where the Python engine lives.
 *
 * Unpackaged, that is simply the folder above this one. Packaged, `__dirname`
 * is inside the app archive, so the same join would point at the archive's own
 * parent and `-m csdm.bridge` would resolve nothing: the window would open and
 * the engine would never start. So the packaged build walks up from the
 * launcher's folder looking for the `csdm/bridge` package, which is what keeps
 * a portable build working as long as it sits somewhere under the project.
 *
 * One twist: the portable target is an NSIS stub that unpacks the app to a
 * temp directory and runs it from there, so `process.execPath` points inside
 * the extraction, not at the exe the user double-clicked. electron-builder
 * records the launcher's real folder in `PORTABLE_EXECUTABLE_DIR`; the walk
 * starts there, and falls back to `process.execPath` only when the variable is
 * absent (non-portable packaged builds).
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
  const anchor = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  let dir = anchor;
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
const WINDOW_DEFAULT_W = 1100;
const WINDOW_DEFAULT_H = 900;
const WINDOW_MIN_W = 900;
const WINDOW_MIN_H = 640;

// How long the engine is given to stop its own children cleanly before the
// process tree is taken out from under it. Its own kill path (request_kill in
// csdm/engine/core.py) stops the CSDM CLI, taskkills cs2.exe and reverts the
// tags this batch applied -- all of it lost if we terminate Python first.
const ENGINE_SHUTDOWN_GRACE_MS = 4000;

let mainWindow = null;
let child = null;
let stdoutBuffer = ""; // holds a line fragment carried over between two stdout chunks
let quitting = false; // true once before-quit has taken over the shutdown

/**
 * Find a Python interpreter able to run this repo.
 *
 * Priority: an explicit override (CSDM_PYTHON_PATH), then the interpreters
 * most likely to be on a Windows dev machine, then the generic names on
 * PATH. Each candidate is probed with `-c "import psycopg2"` -- the engine's
 * hard dependency -- so a name that resolves to an interpreter without the
 * app's packages is skipped instead of failing later inside the engine.
 *
 * A `--version` probe is not enough: on this machine the Windows launcher's
 * default (`py` -> Python 3.14) answers it while missing psycopg2, and the
 * engine would then crash on its first database command with a bare
 * `'NoneType' object has no attribute 'OperationalError'` (core.py guards
 * the import with `psycopg2 = None`). Probing the real capability accepts
 * only an interpreter that can actually run the engine.
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
    const probe = spawnSync(candidate, ["-c", "import psycopg2"], { windowsHide: true });
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
  stdoutBuffer = ""; // a fragment from a dead engine must never prefix a new one's first line
  resetEngineState();

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
        const message = JSON.parse(line);
        noteEngineState(message);
        sendToRenderer(message);
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

/**
 * Stop the engine and everything it started.
 *
 * `child.kill()` alone is not enough on Windows: it terminates the Python
 * process only. Windows has no inherited process group, so the CSDM CLI that
 * the engine spawned (csdm/engine/core.py, `self._proc`) and the cs2.exe that
 * CLI drives both keep running, with no interface left to stop them. That is
 * D19's "no orphan is allowed to keep driving CS2", which this file claimed
 * and did not do.
 */
function killEngine() {
  if (!child) return;
  const doomed = child;
  const pid = doomed.pid;
  child = null;
  stdoutBuffer = "";
  resetEngineState();
  if (process.platform === "win32" && pid) {
    spawnSync("taskkill", buildTreeKillArgs(pid), { windowsHide: true });
  }
  if (!doomed.killed) {
    doomed.kill();
  }
}

/**
 * Ask the engine to stop cleanly, then take the tree out regardless.
 *
 * The graceful step only happens during a run: at rest it would add a delay
 * for nothing, and `request_kill` would taskkill a cs2.exe this app never
 * launched. The grace period is a ceiling, not a wait -- the child's own
 * `exit` ends it as soon as it really goes.
 */
function shutdownEngine() {
  return new Promise((resolve) => {
    if (!child) {
      resolve();
      return;
    }
    if (!engineIsBusy()) {
      killEngine();
      resolve();
      return;
    }
    const doomed = child;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killEngine();
      resolve();
    };
    const timer = setTimeout(finish, ENGINE_SHUTDOWN_GRACE_MS);
    doomed.once("exit", finish);
    // The engine is the only side that knows about cs2.exe and about the tags
    // this batch applied. Let it undo its own work first.
    sendCommandToEngine({ type: "command", id: "shutdown", name: "request_kill" });
  });
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
      sandbox: true,
    },
  });

  // A webContents is free to navigate to any URL by default. This window
  // has exactly one page it is allowed to open: the one this file loads below.
  // Any other URL is the process trying to surf away, which a utility shell
  // must never do. (Electron 38 warns when this handler is missing.)
  mainWindow.webContents.on("will-navigate", (_event, url) => {
    console.warn(`blocked navigation to ${url}`);
    _event.preventDefault();
  });

  // The shell opens no popups and has no links. If something in the renderer
  // tries a `window.open`, catch it here instead of letting Electron do
  // whatever it would do with an unregistered URL.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Closing mid-run throws away work: the batch stops, the assembly never
  // happens, and the tags applied so far are reverted. Ask first. Native
  // dialog rather than a React one, because the renderer may be the thing
  // that died.
  mainWindow.on("close", (event) => {
    if (quitting || !engineIsBusy()) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Keep running", "Stop the run and quit"],
      defaultId: 0, // Enter keeps the run: the safe answer is the default one
      cancelId: 0, // Escape and the title-bar cross do too
      noLink: true,
      title: "A run is in progress",
      message: "A run is still going.",
      detail:
        "Quitting stops it now: the remaining demos are skipped, no video is assembled, " +
        "and the tags applied during this batch are reverted.",
    });
    if (choice === 0) event.preventDefault();
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

// Restart the engine after it died. The renderer has no way to start a
// process, so this stays in the main process. It kills whatever is left
// of the previous engine (belt and suspenders) before spawning a new one.
ipcMain.handle("bridge:restart-engine", async () => {
  killEngine();
  startEngine();
});

app.whenReady().then(() => {
  startEngine();
  createWindow();
});

// D19: no orphan is allowed to keep driving CS2. Closing the last window
// quits, which fires `before-quit` -- the single place the engine is stopped,
// so there is no second path that could diverge from it.
app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (quitting || !child) return;
  // Stopping the engine is asynchronous (it may have a cs2.exe to kill first)
  // and `before-quit` is not. Hold the quit, do the work, then exit for real.
  event.preventDefault();
  quitting = true;
  shutdownEngine().then(() => app.exit(0));
});
