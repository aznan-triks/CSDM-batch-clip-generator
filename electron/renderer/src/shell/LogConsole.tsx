import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { onMessage, runCommand, send } from "../bridge";
import { downloadFile } from "../download";
import { useTracing } from "../debug/useTracing";
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
export const LOG_CONSOLE = {
  maxRendered: 1500,
  /** How long a status line (P4, the Tkinter `_log_flash`) stays in the log. */
  flashMs: 3000,
  logFileName: "csdm-console-log.txt",
  htmlFileName: "csdm-console-export.html",
} as const;


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
  /** A status line the console wrote itself; it leaves after `flashMs`. */
  flash?: boolean;
}

const PREVIEW_EXPORT_TIP =
  "Every clip the last PREVIEW found: date, demo, weapon, filters, tick and its playdemo command";

/** What `export_preview` answers with: the file, ready to save. */
interface PreviewExport {
  content: string;
  filename: string;
  mime: string;
  clips: number;
}

/** Every [start, end) of `needle` in `haystack`, case-insensitive. */
function matchRanges(haystack: string, needle: string): [number, number][] {
  if (!needle) return [];
  const ranges: [number, number][] = [];
  const lower = haystack.toLowerCase();
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    ranges.push([at, at + needle.length]);
  }
  return ranges;
}

/**
 * `text`, which starts at `offset` in its line, with the parts inside `ranges`
 * wrapped in <mark>. The search highlight of the Tkinter console
 * (`search_hi`), cut at run boundaries so each piece keeps its level colour.
 */
function withMarks(text: string, offset: number, ranges: [number, number][]): ReactNode {
  if (!ranges.length) return text;
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    const from = Math.max(start - offset, cursor);
    const to = Math.min(end - offset, text.length);
    if (to <= from) continue;
    if (from > cursor) pieces.push(text.slice(cursor, from));
    pieces.push(
      <mark key={from} className="log-hit">
        {text.slice(from, to)}
      </mark>,
    );
    cursor = to;
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return pieces;
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

/** The console's own lines as a standalone HTML page. */
function linesAsHtml(lines: Line[]): string {
  const body = lines
    .map((line) => `<div class="${line.cssClass}">${escapeHtml(line.text)}</div>`)
    .join("\n");
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<title>CSDM console export</title></head><body><pre>" +
    body +
    "</pre></body></html>"
  );
}

/** The console's own lines as plain text, one per line (Tkinter `_log_save`). */
function linesAsText(lines: Line[]): string {
  return lines.map((line) => `${formatTimestamp(line.ts)} ${line.text}`).join("\n");
}

/**
 * The right-hand column: everything the engine says, plus the question panel.
 *
 * Lifted out of App.tsx unchanged when the shell arrived. It is hidden by CSS
 * in the narrow layout and never unmounted -- the lines are the only record of
 * a run, and unmounting would throw them away.
 */
export default function LogConsole() {
  // The diagnostic switch lives here rather than in Settings on purpose: the
  // console is where the user already looks when something did not happen,
  // and a switch you have to go find in another tab is a switch nobody flips.
  const { tracing, setTracing, exportTrace } = useTracing();
  const [lines, setLines] = useState<Line[]>([]);
  // A QUEUE, not a single slot. Each `ask` blocks one engine worker thread
  // until its own id is answered, so a second question must wait its turn
  // rather than replace the first -- replacing it would strand the first
  // thread waiting on an answer that can no longer be sent.
  const [asks, setAsks] = useState<PendingAsk[]>([]);
  const [search, setSearch] = useState("");
  // Which match the search is on (J5/J6), as an index into the matching lines.
  const [searchIndex, setSearchIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
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
  // While a search is open the reader is walking its matches: a new line must
  // not throw them back to the bottom (the Tkinter console `see()`s the match).
  const searching = search.trim() !== "";
  useEffect(() => {
    if (!autoScroll || searching) return;
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, autoScroll, searching]);

  // Ctrl+F opens the search (J4), from anywhere in the window, as it did in
  // the Tkinter console. The console is never unmounted, so this is too.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Add lines the console writes itself (status, injection preview). */
  function append(entries: Omit<Line, "key" | "ts">[]) {
    const stamped = entries.map((entry) => {
      nextKey.current += 1;
      return { ...entry, key: nextKey.current, ts: Date.now() };
    });
    setLines((previous) => [...previous, ...stamped]);
    return stamped.map((line) => line.key);
  }

  /**
   * A status line that leaves by itself after `flashMs` (P4): the Tkinter
   * console's `_log_flash`. Saving, exporting and copying report here, where
   * the user is already looking, and do not clutter the record of the run.
   */
  function flash(text: string, level: "ok" | "warn" | "err") {
    const [key] = append([{ runs: [[text, level]], text, cssClass: levelClass(level), level, flash: true }]);
    window.setTimeout(() => {
      setLines((previous) => previous.filter((line) => line.key !== key));
    }, LOG_CONSOLE.flashMs);
  }

  /** The reason a command failed, in the engine's own words. */
  function reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function saveLog() {
    const saved = downloadFile(LOG_CONSOLE.logFileName, linesAsText(recorded()), "text/plain");
    if (saved) flash("✓ Log saved", "ok");
    else flash("✗ The log could not be saved here", "err");
  }

  async function exportPreview(format: string) {
    try {
      const result = await runCommand("export_preview", { format });
      const file = result.data as PreviewExport;
      if (downloadFile(file.filename, file.content, file.mime)) {
        flash(`✓ Preview exported (${file.clips} clips)`, "ok");
      } else {
        flash("✗ The preview could not be saved here", "err");
      }
    } catch (error) {
      flash(`⚠ ${reason(error)}`, "warn");
    }
  }

  /**
   * What the next run would inject into CS2 (M8), written into the console:
   * the Tkinter INJECTION PREVIEW section, read from the engine with the
   * settings as they stand now. Asking again refreshes it.
   */
  async function showInjection() {
    try {
      const result = await runCommand("injection_preview", { cfg: settingsRef.current });
      const rows = (result.lines as [string, string][]) ?? [];
      append([
        { runs: [["── CS2 injection preview ──", "dim"]], text: "── CS2 injection preview ──", cssClass: "line-dim", level: "" },
        ...rows.map(([text, kind]) => ({
          runs: [[text, kind === "dim" ? "dim" : ""]] as Run[],
          text,
          cssClass: kind === "key" ? "line-key" : kind === "dim" ? "line-dim" : "",
          level: "",
        })),
      ]);
    } catch (error) {
      flash(`⚠ ${reason(error)}`, "warn");
    }
  }

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

  /** The record of the run: what the exports write, status lines left out. */
  const recorded = () => lines.filter((line) => !line.flash);

  const trimmedSearch = search.trim().toLowerCase();
  const matching = trimmedSearch
    ? lines.filter((line) => line.text.toLowerCase().includes(trimmedSearch))
    : lines;
  // The search keeps filtering (the lines shown are the lines that match) and
  // also walks them, one at a time, the way the Tkinter search bar did:
  // Enter / ▼ next, Shift+Enter / ▲ previous, Esc closes.
  const matchCount = trimmedSearch ? matching.length : 0;
  const current = matchCount ? ((searchIndex % matchCount) + matchCount) % matchCount : -1;
  const currentKey = current >= 0 ? matching[current].key : null;

  useEffect(() => {
    if (currentKey === null) return;
    const element = logRef.current?.querySelector(`[data-line="${currentKey}"]`);
    // jsdom has no scrollIntoView; the real window does.
    element?.scrollIntoView?.({ block: "nearest" });
  }, [currentKey]);

  function stepSearch(delta: number) {
    setSearchIndex((previous) => previous + delta);
  }

  function closeSearch() {
    setSearch("");
    setSearchIndex(0);
    searchRef.current?.blur();
  }
  // The TAIL, bounded. A batch of several hundred clips writes thousands of
  // lines into a scrolling area that sits inside a `backdrop-filter` surface,
  // so every one of them costs a re-blur on every repaint -- the player list's
  // problem, except it grows while the user watches.
  //
  // The lines themselves are KEPT: a work tool's log is the record of a run,
  // and the log exports still write every one. Only the rendering is cut,
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
              ref={searchRef}
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  stepSearch(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                }
              }}
              placeholder="filter…"
              title="Search the console (Ctrl+F). Enter: next match, Shift+Enter: previous, Esc: close"
              data-action="J4"
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

          <button
            type="button"
            role="checkbox"
            aria-checked={tracing}
            aria-label="Debug trace"
            className={tracing ? "chip on" : "chip"}
            title="Record every command sent to the engine, every answer and every state event, with timings. Off by default; export the recording from the Export menu"
            data-action="J13"
            onClick={() => setTracing(!tracing)}
          >
            DEBUG
          </button>

          <button type="button" className="chip" title="Copy all console output to clipboard" data-action="J12" onClick={copyAll}>
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
              title="Save the log, export preview clips, inspect"
              data-action="K1"
              onClick={() => setExportMenuOpen((previous) => !previous)}
            >
              Export ▾
            </button>
            {exportMenuOpen && (
              <div className="log-export-menu" role="menu">
                <span className="log-export-group" role="presentation">Console log</span>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Console log, Text (.txt)"
                  title="Save every console line, with its time, to a text file"
                  data-action="J14"
                  onClick={() => {
                    saveLog();
                    setExportMenuOpen(false);
                  }}
                >
                  Text (.txt)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Console log, HTML (.html)"
                  title="Save every console line, with its colour, to an HTML page"
                  onClick={() => {
                    const saved = downloadFile(LOG_CONSOLE.htmlFileName, linesAsHtml(recorded()), "text/html");
                    if (!saved) flash("✗ The log could not be saved here", "err");
                    setExportMenuOpen(false);
                  }}
                >
                  HTML (.html)
                </button>
                <span className="log-export-group" role="presentation">Preview clip list</span>
                {/* One literal marker per format: the parity ledger reads them
                    out of the source. The formats are the engine's
                    (`csdm/engine/preview_export.py::PREVIEW_EXPORT_FORMATS`). */}
                <button type="button" role="menuitem" aria-label="Preview clips, HTML (.html)" title={PREVIEW_EXPORT_TIP} data-action="K2"
                  onClick={() => { void exportPreview("html"); setExportMenuOpen(false); }}>
                  HTML (.html)
                </button>
                <button type="button" role="menuitem" aria-label="Preview clips, Text (.txt)" title={PREVIEW_EXPORT_TIP} data-action="K3"
                  onClick={() => { void exportPreview("txt"); setExportMenuOpen(false); }}>
                  Text (.txt)
                </button>
                <button type="button" role="menuitem" aria-label="Preview clips, JSON (.json)" title={PREVIEW_EXPORT_TIP} data-action="K4"
                  onClick={() => { void exportPreview("json"); setExportMenuOpen(false); }}>
                  JSON (.json)
                </button>
                <span className="log-export-group" role="presentation">Inspect</span>
                <button
                  type="button"
                  role="menuitem"
                  title="Write into the console the arguments and commands a run with the current settings injects into CS2"
                  data-action="M8"
                  onClick={() => {
                    void showInjection();
                    setExportMenuOpen(false);
                  }}
                >
                  CS2 injection preview
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!tracing}
                  title={tracing
                    ? "Download the recorded command/answer timeline"
                    : "Turn DEBUG on first: there is nothing recorded yet"}
                  onClick={() => {
                    exportTrace();
                    setExportMenuOpen(false);
                  }}
                >
                  Debug trace (.txt)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The Tkinter search bar was its own row under the toolbar, and so is
          this: the walk's count and arrows do not fit beside six chips in
          the console header, where they squeezed the search box to nothing
          and pushed Export off the column (hidden-window proof). */}
      {searching && (
        <div className="log-search-bar" role="search" aria-label="Search results">
          <span className="log-search-count" aria-live="polite">
            {matchCount ? `${current + 1}/${matchCount}` : "0 results"}
          </span>
          <button
            type="button"
            className="chip"
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            data-action="J6"
            disabled={!matchCount}
            onClick={() => stepSearch(-1)}
          >
            ▲
          </button>
          <button
            type="button"
            className="chip"
            aria-label="Next match"
            title="Next match (Enter)"
            data-action="J5"
            disabled={!matchCount}
            onClick={() => stepSearch(1)}
          >
            ▼
          </button>
          <button
            type="button"
            className="chip"
            aria-label="Close search"
            title="Close the search (Esc)"
            data-action="J7"
            onClick={closeSearch}
          >
            Esc
          </button>
        </div>
      )}

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
            <button type="button" data-action="P6" onClick={() => answer(null)}>
              Cancel
            </button>
          )}
        </div>
      )}

      {/* The mock's `.body`. It keeps `id="log"`: the auto-scroll aims at it,
          and so does every test that counts lines. */}
      <div className="body" id="log" ref={logRef}>
        {visibleLines.map((line, lineIndex) => (
          <div
            key={line.key}
            data-line={line.key}
            data-action={line.flash ? "P4" : undefined}
            className={[line.cssClass, line.key === currentKey ? "log-search-cur" : ""].filter(Boolean).join(" ")}
          >
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
              const hits = matchRanges(line.text, trimmedSearch);
              let used = 0;
              return line.runs.map(([piece, level], index) => {
                const from = used;
                used += piece.length;
                if (budget === Infinity) {
                  return (
                    <span key={index} className={levelClass(level)}>
                      {withMarks(piece, from, hits)}
                    </span>
                  );
                }
                const take = Math.max(0, Math.min(piece.length, budget - from));
                if (take === 0) return null;
                return (
                  <span key={index} className={levelClass(level)}>
                    {withMarks(piece.slice(0, take), from, hits)}
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
