import { useEffect, useRef, useState } from "react";

import { onMessage, send } from "../bridge";
import type { BridgeMessage } from "../bridge";
import "./LogConsole.css";

/** One rendered console line. `key` is a counter: two identical lines are distinct events. */
interface Line {
  key: number;
  text: string;
  cssClass: string;
  /** The level the line carries (only "log" messages have one), for the badge toggle. */
  level: string;
  /** When the line arrived, for the timestamp toggle. */
  ts: number;
}

/**
 * The question currently on screen, or null when nothing is pending.
 *
 * `kind` is carried because the two shapes are answered differently, exactly
 * as the Tkinter host answers them (`csdm_batch_clips_generator.py::ask`):
 * an `error` has no options and always answers "ok"; anything else is titled
 * by `options[0]`, offers `options[1..]`, and can be cancelled with null.
 */
interface PendingAsk {
  id: string;
  kind: string;
  title: string;
  choices: string[];
}

function levelClass(level: string | undefined): string {
  switch (level) {
    case "err":
      return "line-err";
    case "warn":
      return "line-warn";
    case "ok":
      return "line-ok";
    case "dim":
      return "line-dim";
    default:
      return "";
  }
}

/** Render one protocol message the way the skeleton page did, verbatim. */
function describe(message: BridgeMessage): { text: string; cssClass: string } {
  switch (message.type) {
    case "log":
      return {
        text: `[log:${message.level || "-"}] ${message.message}`,
        cssClass: levelClass(message.level),
      };
    case "log_parts":
      return {
        text: `[log_parts] ${message.parts.map(([text]) => text).join("")}`,
        cssClass: "",
      };
    case "state":
      return {
        text: `[state] ${message.name} ${JSON.stringify(message.payload)}`,
        cssClass: "line-dim",
      };
    case "ask":
      return { text: `[ask:${message.kind}] ${message.message}`, cssClass: "" };
    case "result":
      return {
        text:
          `[result] id=${message.id} ok=${message.ok}` +
          (message.error ? ` error=${message.error}` : ""),
        cssClass: "",
      };
    case "fatal":
      return { text: `[fatal] ${message.error}`, cssClass: "line-err" };
    case "child_exit":
      return {
        text: `[bridge] python engine exited (code=${message.code}, signal=${message.signal})`,
        cssClass: "line-err",
      };
    case "child_error":
      return {
        text: `[bridge] failed to start python engine: ${message.error}`,
        cssClass: "line-err",
      };
    default:
      return { text: `[unknown] ${JSON.stringify(message)}`, cssClass: "line-dim" };
  }
}

/** `HH:MM:SS`, local time -- the same shape the window's log timestamps used. */
function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build a standalone HTML file from the lines on screen and trigger a
 * download.
 *
 * The old Tkinter window's "Export ▾" menu (HTML / TXT / JSON) exported the
 * last PREVIEW RESULT -- a different table entirely, built from data the
 * engine attaches to `preview_ready`. Reproducing that here would need the
 * preview result plumbed into this component and a JSON/table renderer that
 * does not exist yet, well past this task's scope. What this menu exports
 * instead is the console's own lines, which the renderer already holds --
 * the one export the existing data supports honestly.
 *
 * There is also no `pickSavePath`-driven save dialog: writing the chosen path
 * would need a new IPC method in `main.js`/`preload.js`, which is likewise
 * out of scope here. The browser download the `<a download>` triggers is the
 * simplest thing that actually ships a file without adding that surface.
 */
function exportLinesAsHtml(lines: Line[]): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    console.warn("log export unavailable: no Blob/URL support in this environment");
    return;
  }
  const body = lines
    .map((line) => `<div class="${line.cssClass}">${escapeHtml(line.text)}</div>`)
    .join("\n");
  const html =
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<title>CSDM console export</title></head><body><pre>" +
    body +
    "</pre></body></html>";
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "csdm-console-export.html";
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The right-hand column: everything the engine says, plus the question panel.
 *
 * Lifted out of App.tsx unchanged when the shell arrived. It is hidden by CSS
 * in the narrow layout and never unmounted -- the lines are the only record of
 * a run, and unmounting would throw them away.
 */
export default function LogConsole() {
  const [lines, setLines] = useState<Line[]>([]);
  // A QUEUE, not a single slot. Each `ask` blocks one engine worker thread
  // until its own id is answered, so a second question must wait its turn
  // rather than replace the first -- replacing it would strand the first
  // thread waiting on an answer that can no longer be sent.
  const [asks, setAsks] = useState<PendingAsk[]>([]);
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showBadges, setShowBadges] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const ask = asks[0] ?? null;
  const logRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);

  useEffect(() => {
    return onMessage((message) => {
      const { text, cssClass } = describe(message);
      const level = message.type === "log" ? message.level || "" : "";
      nextKey.current += 1;
      const key = nextKey.current;
      setLines((previous) => [...previous, { key, text, cssClass, level, ts: Date.now() }]);

      if (message.type === "ask") {
        // `options[0]` is the dialog title, the rest are the answers.
        // An error ask carries NO options: its message is the whole dialog,
        // and `options.slice(1)` on an empty array is what left it with no
        // button to press while the engine thread waited on it forever.
        const isError = message.kind === "error";
        setAsks((previous) => [
          ...previous,
          {
            id: message.id,
            kind: message.kind,
            title: isError ? message.message : (message.options[0] ?? message.message),
            choices: isError ? [] : message.options.slice(1),
          },
        ]);
      }
    });
  }, []);

  // Follow the tail, the way the skeleton page did on every appended line --
  // unless the auto-scroll toggle is off, in which case the reader has
  // deliberately scrolled up to read something and a jump would throw them
  // back to the bottom mid-read.
  useEffect(() => {
    if (!autoScroll) return;
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, autoScroll]);

  function answer(value: string | null) {
    if (!ask) return;
    send({ type: "answer", id: ask.id, value });
    setAsks((previous) => previous.slice(1));
  }

  const trimmedSearch = search.trim().toLowerCase();
  const visibleLines = trimmedSearch
    ? lines.filter((line) => line.text.toLowerCase().includes(trimmedSearch))
    : lines;

  return (
    <div className="console">
      {/* The mock's `.ch`: a titled bar, its own hairline, the tools closing it
          on the right. The title is what makes the column read as an
          instrument rather than a stray box of text. */}
      <div className="ch">
        <b>Console</b>
        <div className="tools">
          <label className="log-search">
            Search
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="filter…"
            />
          </label>

          <button
            type="button"
            role="checkbox"
            aria-checked={autoScroll}
            aria-label="Auto-scroll"
            className={autoScroll ? "log-toggle log-toggle-on" : "log-toggle"}
            onClick={() => setAutoScroll((previous) => !previous)}
          >
            ↓
          </button>

          <button
            type="button"
            role="checkbox"
            aria-checked={showTimestamps}
            aria-label="Timestamps"
            className={showTimestamps ? "log-toggle log-toggle-on" : "log-toggle"}
            onClick={() => setShowTimestamps((previous) => !previous)}
          >
            TS
          </button>

          <button
            type="button"
            role="checkbox"
            aria-checked={showBadges}
            aria-label="Level badges"
            className={showBadges ? "log-toggle log-toggle-on" : "log-toggle"}
            onClick={() => setShowBadges((previous) => !previous)}
          >
            Badges
          </button>

          <div className="log-export">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              onClick={() => setExportMenuOpen((previous) => !previous)}
            >
              Export ▾
            </button>
            {exportMenuOpen && (
              <div className="log-export-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    exportLinesAsHtml(lines);
                    setExportMenuOpen(false);
                  }}
                >
                  HTML (.html)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {ask && (
        <div id="ask-panel" role="alertdialog" aria-label={ask.title}>
          <span>{ask.title} </span>
          {ask.choices.map((choice) => (
            <button type="button" key={choice} onClick={() => answer(choice)}>
              {choice}
            </button>
          ))}
          {/* Always reachable. An `error` answers "ok" the way the Tkinter
              host's `messagebox.showerror` does; anything else answers null,
              which the engine handles as its own branch. Without this the
              engine thread blocks on `done.wait()` with no timeout. */}
          {ask.kind === "error" ? (
            <button type="button" onClick={() => answer("ok")}>
              OK
            </button>
          ) : (
            <button type="button" onClick={() => answer(null)}>
              Cancel
            </button>
          )}
        </div>
      )}

      {/* The mock's `.body`. It keeps `id="log"`: the auto-scroll aims at it,
          and so does every test that counts lines. */}
      <div className="body" id="log" ref={logRef}>
        {visibleLines.map((line) => (
          <div key={line.key} className={line.cssClass}>
            {showTimestamps && <span className="log-ts">{formatTimestamp(line.ts)} </span>}
            {showBadges && line.level && (
              <span className={`log-badge ${line.cssClass}`}>{line.level.toUpperCase()}</span>
            )}
            {line.text}
          </div>
        ))}

        {/* The prompt, and it is MUTE. The mock types a fake command into it;
            this window has no command line, and a line that writes itself
            would invite the user to type where nothing listens. The shape is
            the mock's, the lie is not. */}
        <div className="promptline">
          <span className="prompt">csdm&gt;</span>
          <span className="cur" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
