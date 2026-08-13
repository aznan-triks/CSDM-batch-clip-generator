import { useEffect, useRef, useState } from "react";

import { onMessage, send } from "../bridge";
import { useAllSettings } from "../settings/store";
import { PROMPT_COMMANDS, narrate, promptFor, reciteSelection } from "./consoleNarrative";
import { useTypewriter } from "./useTypewriter";
import type { Run } from "./consoleNarrative";
import "./LogConsole.css";

/**
 * How much of the log reaches the DOM at once.
 *
 * HC.1: a bound, not a number buried in a render. The approved mock trims its
 * own console past 40 lines; this one keeps far more, because 40 is a demo's
 * worth and a real batch's log is the only record of what happened. What it
 * does NOT do is grow forever, which is what it did before.
 */
export const LOG_CONSOLE = { maxRendered: 1500 } as const;

/**
 * One rendered console line.
 *
 * `runs` is the line as the engine sends it -- a list of [text, level] pieces,
 * which is what makes a multicolour line possible. `text` is the same content
 * flattened, kept because search and export both work on plain text.
 * `key` is a counter: two identical lines are distinct events.
 */
interface Line {
  key: number;
  runs: Run[];
  text: string;
  cssClass: string;
  /** The level the line carries, for the badge toggle. */
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
/**
 * Copy plain text to the clipboard, tolerating the environments that don't
 * have one (jsdom under test, a browser tab with no secure context).
 *
 * Mirrors the old Tkinter window's `_log_copy_all`/`_log_copy_sel`
 * (`clipboard_clear` + `clipboard_append`) -- AUDIT_console_resize_boutons.md.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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
  // ON by default: the approved mock timestamps every line, and a run's log is
  // read afterwards to find out WHEN something happened.
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [prompt, setPrompt] = useState(PROMPT_COMMANDS.idle);
  const [showBadges, setShowBadges] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const ask = asks[0] ?? null;
  const logRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);

  // What the user picked. Read through a ref because the subscription below is
  // installed once: reading `settings` from the closure would freeze it at the
  // values it held on mount, and a run started an hour later would recite them.
  const settings = useAllSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    return onMessage((message) => {
      const nextPrompt = promptFor(message);
      if (nextPrompt !== null) setPrompt(nextPrompt);

      // The event's own line, then -- when it starts something -- the
      // selection it is about to act on. The engine reports what it DOES and
      // never what was picked, so this is the one thing the window can say
      // that the pipe cannot.
      const narrated = narrate(message);
      const written = [
        // `null` means the event steers the window without being worth a line.
        ...(narrated ? [narrated] : []),
        ...reciteSelection(message, settingsRef.current),
      ];
      if (written.length) {
        const stamped = written.map((line) => {
          nextKey.current += 1;
          return {
            key: nextKey.current,
            runs: line.runs,
            text: line.runs.map(([piece]) => piece).join(""),
            cssClass: levelClass(line.level),
            level: line.level,
            ts: Date.now(),
          };
        });
        setLines((previous) => [...previous, ...stamped]);
      }

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

  async function copyAll() {
    const ok = await copyToClipboard(lines.map((line) => line.text).join("\n"));
    setCopyStatus(ok ? "✓ All copied" : "");
  }

  async function copySelection() {
    const selected = typeof window !== "undefined" ? window.getSelection()?.toString() ?? "" : "";
    const ok = await copyToClipboard(selected);
    setCopyStatus(ok ? "✓ Selection copied" : selected ? "" : "Nothing selected");
  }

  const trimmedSearch = search.trim().toLowerCase();
  const matching = trimmedSearch
    ? lines.filter((line) => line.text.toLowerCase().includes(trimmedSearch))
    : lines;
  // The TAIL, bounded. A batch of several hundred clips writes thousands of
  // lines into a scrolling area that sits inside a `backdrop-filter` surface,
  // so every one of them costs a re-blur on every repaint -- the player list's
  // problem, except it grows while the user watches.
  //
  // The lines themselves are KEPT: a work tool's log is the record of a run,
  // and `exportLinesAsHtml` still writes every one. Only the rendering is cut,
  // which is strictly more than the mock does (it drops its own past 40).
  const visibleLines =
    matching.length > LOG_CONSOLE.maxRendered
      ? matching.slice(matching.length - LOG_CONSOLE.maxRendered)
      : matching;

  // Each visible line writes itself out, as the approved mock does. Derived
  // from the flattened text, so the runs below can be cut at the same point.
  const revealed = useTypewriter(visibleLines.map((line) => line.text.length));

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
            className={autoScroll ? "chip on" : "chip"}
            title="Auto-scroll the console to the newest line"
            data-action="J1"
            onClick={() => setAutoScroll((previous) => !previous)}
          >
            ↓
          </button>

          <button
            type="button"
            role="checkbox"
            aria-checked={showTimestamps}
            aria-label="Timestamps"
            className={showTimestamps ? "chip on" : "chip"}
            title="Show the time each console line arrived"
            data-action="J2"
            onClick={() => setShowTimestamps((previous) => !previous)}
          >
            TS
          </button>

          <button
            type="button"
            role="checkbox"
            aria-checked={showBadges}
            aria-label="Level badges"
            className={showBadges ? "chip on" : "chip"}
            title="Show a colored level label (ERR/WARN/OK) on each line"
            data-action="J3"
            onClick={() => setShowBadges((previous) => !previous)}
          >
            Badges
          </button>

          <button type="button" className="chip" data-action="J12" onClick={copyAll}>
            Copy all
          </button>

          <button type="button" className="chip" title="Copy the currently highlighted console text" data-action="J10" onClick={copySelection}>
            Copy sel.
          </button>

          {copyStatus && <span className="log-copy-status">{copyStatus}</span>}

          <div className="log-export">
            <button
              type="button"
              className="chip"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              title="Download the full console log as an HTML file"
              data-action="K1"
              onClick={() => setExportMenuOpen((previous) => !previous)}
            >
              Export ▾
            </button>
            {exportMenuOpen && (
              <div className="log-export-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  data-action="K2"
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
            <button type="button" key={choice} data-action="P6" onClick={() => answer(choice)}>
              {choice}
            </button>
          ))}
          {/* Always reachable. An `error` answers "ok" the way the Tkinter
              host's `messagebox.showerror` does; anything else answers null,
              which the engine handles as its own branch. Without this the
              engine thread blocks on `done.wait()` with no timeout. */}
          {ask.kind === "error" ? (
            <button type="button" data-action="P7" onClick={() => answer("ok")}>
              OK
            </button>
          ) : (
            <button type="button" data-action="P9" onClick={() => answer(null)}>
              Cancel
            </button>
          )}
        </div>
      )}

      {/* The mock's `.body`. It keeps `id="log"`: the auto-scroll aims at it,
          and so does every test that counts lines. */}
      <div className="body" id="log" ref={logRef}>
        {visibleLines.map((line, lineIndex) => (
          <div key={line.key} className={line.cssClass}>
            {showTimestamps && <span className="log-ts">{formatTimestamp(line.ts)} </span>}
            {showBadges && line.level && (
              <span className={`log-badge ${line.cssClass}`}>{line.level.toUpperCase()}</span>
            )}
            {/* One <span> per run, each tinted by its own level. The engine
                sends its lines as coloured pieces and they used to be joined
                into one grey string here -- the capability existed at both
                ends of the pipe and died at the last step.
                The typewriter cuts ACROSS the runs: `shown` is how many
                characters of the whole line are out, so a two-colour line is
                written through its colour change rather than per piece. */}
            {(() => {
              const budget = revealed(lineIndex);
              let used = 0;
              return line.runs.map(([piece, level], index) => {
                const from = used;
                used += piece.length;
                if (budget === Infinity) {
                  return (
                    <span key={index} className={levelClass(level)}>
                      {piece}
                    </span>
                  );
                }
                const take = Math.max(0, Math.min(piece.length, budget - from));
                if (take === 0) return null;
                return (
                  <span key={index} className={levelClass(level)}>
                    {piece.slice(0, take)}
                  </span>
                );
              });
            })()}
          </div>
        ))}

        {/* The prompt, and it is MUTE. The mock types a fake command into it;
            this window has no command line, and a line that writes itself
            would invite the user to type where nothing listens. The shape is
            the mock's, the lie is not. */}
        <div className="promptline">
          <span className="prompt">csdm&gt;</span>
          {prompt && <span className="prompt-cmd"> {prompt}</span>}
          <span className="cur" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
