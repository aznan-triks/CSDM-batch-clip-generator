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
  onMessage(cb) {
    ipcRenderer.on("bridge:message", (_event, message) => cb(message));
  },
});
