/**
 * Hand a text file to the user: a Blob behind an `<a download>`.
 *
 * The one mechanism every console export uses (log, preview clip list, debug
 * trace). The renderer has no filesystem access (contextIsolation); Electron
 * answers the download with its native save dialog, so no extra IPC is needed.
 *
 * Returns false where there is no Blob/URL support (jsdom, an odd embed), so
 * the caller can say the file was not written instead of claiming it was.
 */
export function downloadFile(name: string, content: string, mime: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    console.warn(`${name}: download unavailable, no Blob/URL support in this environment`);
    return false;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
