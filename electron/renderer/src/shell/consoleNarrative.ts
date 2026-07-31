import type { BridgeMessage, LogLevel } from "../bridge";

/**
 * What the console SAYS, as opposed to what the pipe carries.
 *
 * The console used to render the transport verbatim: `[log:ok] …`, `[state]
 * progress {"text":"…"}`, `[result] id=7 ok=true`. Three things were wrong
 * with that, and only the third is the one the report named.
 *
 * 1. `[log:ok]` repeats in text what the colour already says -- the level is
 *    already carried as a CSS class.
 * 2. `log_parts` arrives from the engine as a LIST of coloured runs, exactly
 *    the shape the approved mock writes (`[['▶ ','b'],['preview: …']]`), and
 *    was flattened to one uncoloured string. The capability existed at both
 *    ends of the pipe and died at the last step.
 * 3. `[result] id=7 ok=true` is pure plumbing. The identifier is an internal
 *    counter and the success is already visible in what the window did. A
 *    FAILED result is different: it carries the only explanation there is.
 *
 * And the thirteen state events -- the moments the mock narrates as
 * `▶ preview: querying events…` / `✓ 312 clips matched · ready` -- were dumped
 * as raw JSON in grey.
 *
 * A run of `null` means "say nothing": the event drives the interface, and the
 * interface showing it IS the message.
 */

/** One coloured run of a line: the text, and the level that tints it. */
export type Run = [text: string, level: LogLevel];

export interface NarratedLine {
  runs: Run[];
  /** Feeds the line's CSS class, as before. */
  level: LogLevel;
}

/**
 * The glyphs that open a narrated line, by what the line is about.
 *
 * The mock's own vocabulary (`▶` starting, `✓` done, `!` skipped, `⏸` halting),
 * kept in one place so a new event cannot invent a fifth one in passing.
 */
const MARK = {
  start: "▶ ",
  done: "✓ ",
  warn: "! ",
  halt: "⏸ ",
} as const;

/**
 * The engine's state events, in the words a person would use.
 *
 * A `null` entry is an event that steers the window without being worth a
 * line: the buttons changing state, a preview arriving (the table appearing IS
 * the message), demos being unchecked (the checkboxes moving IS the message).
 * Saying those out loud is the `+/-` spam the approved direction rejected
 * outright -- "NO chip/tab spam, only what the app is actually DOING".
 */
type Narrator = (payload: Record<string, unknown>) => NarratedLine | null;

const asText = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
};

const STATE_NARRATORS: Record<string, Narrator | null> = {
  run_started: () => ({ runs: [[MARK.start, "info"], ["run: launching cs2…", ""]], level: "info" }),
  preview_started: () => ({
    runs: [[MARK.start, "info"], ["preview: querying events…", ""]],
    level: "info",
  }),
  stop_requested: () => ({
    runs: [[MARK.halt, "warn"], ["stop requested · closing cs2…", ""]],
    level: "warn",
  }),
  kill_requested: () => ({ runs: [[MARK.halt, "warn"], ["kill requested", ""]], level: "warn" }),
  process_exited: (payload) => ({
    runs: [[MARK.done, "ok"], [`${asText(payload, "name") || "process"} exited`, ""]],
    level: "ok",
  }),
  // `progress` and `summary` both carry a ready-made line from the engine; the
  // window's job is to show it, not to rewrite it.
  progress: (payload) => {
    const text = asText(payload, "text");
    return text ? { runs: [[text, "dim"]], level: "dim" } : null;
  },
  summary: (payload) => {
    const text = asText(payload, "text");
    if (!text) return null;
    const level = asText(payload, "level");
    if (level === "muted") return { runs: [[MARK.warn, "warn"], [text, ""]], level: "warn" };
    return { runs: [[text, "info"]], level: "info" };
  },
  // Steering, not speech.
  buttons: null,
  buttons_idle: null,
  buttons_busy: null,
  preview_ready: null,
  demos_unchecked: null,
  demo_entry: null,
};

/**
 * Turn one protocol message into the line the console shows, or `null` when it
 * should show nothing.
 */
export function narrate(message: BridgeMessage): NarratedLine | null {
  switch (message.type) {
    case "log": {
      const text = message.message;
      // The engine draws its own separators out of box-drawing characters. A
      // timestamp in front of one turns a rule into a ragged line.
      return { runs: [[text, message.level]], level: message.level };
    }

    case "log_parts":
      // The runs, kept as runs. This is the whole point.
      return { runs: message.parts, level: "" };

    case "state": {
      const narrator = STATE_NARRATORS[message.name];
      if (narrator === undefined) {
        // An event this file has never heard of. Say it plainly rather than
        // swallow it: a silent unknown is how a new engine event goes
        // unnoticed for a release.
        return { runs: [[`${message.name}`, "dim"]], level: "dim" };
      }
      return narrator ? narrator(message.payload) : null;
    }

    case "ask":
      // The panel below carries the question and its buttons; the line is the
      // trace of it having been asked.
      return { runs: [[MARK.warn, "warn"], [message.message, ""]], level: "warn" };

    case "result":
      // Success is plumbing -- the window doing the thing is the message. A
      // failure carries the only explanation there is.
      if (message.ok) return null;
      return {
        runs: [[MARK.warn, "err"], [message.error ?? "command failed", ""]],
        level: "err",
      };

    case "fatal":
      return { runs: [[MARK.warn, "err"], [message.error, ""]], level: "err" };

    case "child_exit":
      return {
        runs: [
          [MARK.warn, "err"],
          [`python engine exited (code=${message.code}, signal=${message.signal})`, ""],
        ],
        level: "err",
      };

    case "child_error":
      return {
        runs: [[MARK.warn, "err"], [`failed to start python engine: ${message.error}`, ""]],
        level: "err",
      };

    default:
      return { runs: [[JSON.stringify(message), "dim"]], level: "dim" };
  }
}

/**
 * The command the `csdm>` prompt shows, for the action under way.
 *
 * The mock loops a fake command in its prompt and swaps it per action. This
 * window has no command line, so the prompt does not pretend to be typed into
 * -- but it can say what the engine is doing, which is the half of the mock's
 * behaviour that carries information rather than decoration.
 */
export const PROMPT_COMMANDS: Record<string, string> = {
  idle: "",
  run: "run --go",
  preview: "run --preview",
  stopping: "stop",
  killing: "kill",
};

/** Which prompt an engine state event switches to, or null to leave it alone. */
export function promptFor(message: BridgeMessage): string | null {
  if (message.type !== "state") return null;
  switch (message.name) {
    case "run_started":
      return PROMPT_COMMANDS.run;
    case "preview_started":
      return PROMPT_COMMANDS.preview;
    case "stop_requested":
      return PROMPT_COMMANDS.stopping;
    case "kill_requested":
      return PROMPT_COMMANDS.killing;
    case "process_exited":
    case "buttons_idle":
      return PROMPT_COMMANDS.idle;
    default:
      return null;
  }
}
