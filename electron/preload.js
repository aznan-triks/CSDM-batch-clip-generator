// Preload script: the only bridge between the isolated renderer and Node.
// Exposes exactly two functions, nothing else -- no Node access leaks into the page.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  // Renderer -> main -> Python child. `command` is a plain JSON-able object.
  send(command) {
    ipcRenderer.send("bridge:send", command);
  },
  // Main -> renderer. `cb` receives one decoded protocol message (or a
  // synthetic {type: "child_exit", ...} / {type: "child_error", ...} event).
  //
  // Returns an unsubscribe function. Without one, every React remount would
  // stack another IPC listener that can never be removed -- StrictMode alone
  // mounts twice in development.
  onMessage(cb) {
    const listener = (_event, message) => cb(message);
    ipcRenderer.on("bridge:message", listener);
    return () => ipcRenderer.removeListener("bridge:message", listener);
  },
  // Ask the main process to open a native picker. Resolves to a path or null.
  pickPath(options) {
    return ipcRenderer.invoke("bridge:pick-path", options);
  },
  // Ask the main process to open a native save-as picker. Resolves to a path or null.
  pickSavePath(options) {
    return ipcRenderer.invoke("bridge:pick-save-path", options);
  },
  restartEngine() {
    return ipcRenderer.invoke("bridge:restart-engine");
  },
  // Resize the live OS window. SettingsTab calls this right after writing
  // ui_window_w/ui_window_h, so Apply/Auto/Reset default take effect at once
  // instead of only on the next launch.
  setWindowBounds(width, height) {
    return ipcRenderer.invoke("bridge:set-window-bounds", { width, height });
  },
});
