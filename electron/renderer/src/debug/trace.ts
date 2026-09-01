/**
 * The diagnostic recorder: what was asked, what came back, and how long it
 * took, on one timeline.
 *
 * Why it exists. Three of the eight symptoms reported on 2026-09-01 --
 * PREVIEW doing nothing, the Tags reload doing nothing -- cannot be told
 * apart by reading code: "the command was never sent", "the engine answered
 * with stale data" and "the answer arrived and React did not re-render" all
 * look identical from the outside. Guessing between them is exactly what this
 * project has paid for repeatedly. So the instrument comes first and the
 * diagnosis second.
 *
 * What it is NOT. Not a second pipe: it records the messages the existing
 * bridge already carries (`bridge.ts`) plus the engine's own `trace` lines,
 * and it never writes to the protocol stream. Not the console: the console
 * narrates for a human (`consoleNarrative.ts`) and deliberately hides
 * protocol detail, which is precisely the detail wanted here.
 *
 * The OFF state is the normal state and must cost nothing observable: every
 * entry point returns on a boolean before touching an argument, and no
 * listener is mounted until `tracing.ts` mounts one.
 */

/**
 * HC.1: every bound of the recorder, named once, at the top.
 *
 * `capacity` -- a bounded ring, because an unbounded one is a leak with a
 * friendly name. 2000 entries covers a full preview plus its run.
 * `detailChars` -- a run config serialises to several kilobytes; the trace
 * wants the shape of a payload, not its contents.
 * `secretKeys` / `mask` -- the trace is meant to be exported and sent to
 * someone. The PostgreSQL password must not travel with it.
 */
export const TRACE = {
  capacity: 2000,
  detailChars: 400,
  secretKeys: ["pass", "pg_pass", "password"] as readonly string[],
  mask: "***",
} as const;

/** Where an entry came from. `engine` is the Python side's own trace line. */
export type TraceKind = "command" | "result" | "state" | "ask" | "fatal" | "engine" | "note";

export interface TraceEntry {
  /** Monotonic counter. A gap between two exported lines means the ring dropped entries. */
  seq: number;
  /** Wall clock, for reading the export next to a console log. */
  at: number;
  /** Monotonic milliseconds, for durations. Wall clock can jump; this cannot. */
  ms: number;
  kind: TraceKind;
  /** Command name, state name, or the engine's own label. */
  name: string;
  /** The command id this entry belongs to, when there is one. */
  id: string | null;
  /**
   * Milliseconds since the command this entry answers.
   *
   * Exact for a `result` (same id). Best effort for a `state`: the protocol
   * carries no id on state events, so it is dated from the most recent
   * command still in flight -- which is the honest answer during a preview,
   * and null when no command is in flight at all.
   */
  sinceCommandMs: number | null;
  /** One line, already flattened and truncated. Never an object to walk later. */
  detail: string;
}

let enabled = false;
let seq = 0;
const entries: TraceEntry[] = [];

/** Commands sent and not yet answered, by id -- the correlation table. */
const inFlight = new Map<string, { name: string; ms: number }>();
/** The last command sent, in flight or not: what an id-less state event is dated from. */
let lastCommand: { name: string; id: string; ms: number } | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Monotonic clock. `performance` is absent in some test environments. */
function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to recorder changes (the switch flipping, an entry landing). */
export function subscribeTrace(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isTracing(): boolean {
  return enabled;
}

export function enableTrace(): void {
  if (enabled) return;
  enabled = true;
  notify();
}

export function disableTrace(): void {
  if (!enabled) return;
  enabled = false;
  notify();
}

export function clearTrace(): void {
  entries.length = 0;
  inFlight.clear();
  lastCommand = null;
  notify();
}

export function snapshot(): TraceEntry[] {
  return [...entries];
}

function push(entry: Omit<TraceEntry, "seq" | "at" | "ms">, ms: number): void {
  seq += 1;
  entries.push({ seq, at: Date.now(), ms, ...entry });
  if (entries.length > TRACE.capacity) entries.splice(0, entries.length - TRACE.capacity);
  notify();
}

/**
 * Flatten a payload to one truncated line, with the secret keys replaced.
 *
 * The replacement runs during serialisation rather than on the resulting
 * string: a password is masked wherever it sits in the object, however deeply
 * nested, instead of relying on a regexp that has to guess at JSON shape.
 */
function summarize(payload: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(payload, (key, value) =>
      TRACE.secretKeys.includes(key) && value ? TRACE.mask : value,
    ) ?? String(payload);
  } catch {
    // A payload that cannot be serialised (a cycle, a DOM node) is still worth
    // one line saying so -- fail visibly, never silently drop the entry.
    text = "<unserialisable payload>";
  }
  if (text.length <= TRACE.detailChars) return text;
  return `${text.slice(0, TRACE.detailChars)}…`;
}

/** Record a command on its way out, before `send` (A2). */
export function recordCommand(name: string, id: string, payload: unknown): void {
  if (!enabled) return;
  const ms = now();
  inFlight.set(id, { name, ms });
  lastCommand = { name, id, ms };
  push({ kind: "command", name, id, sinceCommandMs: null, detail: summarize(payload) }, ms);
}

/** A message this recorder understands, kept structural: `bridge.ts` owns the real union. */
interface IncomingLike {
  type: string;
  id?: string | null;
  name?: string;
  ok?: boolean;
  error?: string;
  payload?: unknown;
  phase?: string;
  ms?: number;
  [key: string]: unknown;
}

/**
 * Record one message arriving from the engine (A4).
 *
 * `log` and `log_parts` are deliberately NOT recorded: the console already
 * shows every one of them, and duplicating a busy run's log here would push
 * the protocol events -- the only thing this recorder exists for -- straight
 * out of the ring.
 */
export function recordIncoming(message: IncomingLike): void {
  if (!enabled) return;
  const ms = now();

  if (message.type === "result") {
    const id = typeof message.id === "string" ? message.id : null;
    const waiting = id !== null ? inFlight.get(id) : undefined;
    if (id !== null) inFlight.delete(id);
    const verdict = message.ok ? "ok" : `FAILED: ${message.error ?? "no reason given"}`;
    const extras = { ...message } as Record<string, unknown>;
    delete extras.type;
    delete extras.id;
    delete extras.ok;
    delete extras.error;
    push(
      {
        kind: "result",
        name: waiting?.name ?? "<unmatched result>",
        id,
        sinceCommandMs: waiting ? ms - waiting.ms : null,
        detail: `${verdict} ${summarize(extras)}`,
      },
      ms,
    );
    return;
  }

  if (message.type === "state") {
    const anchor = lastCommand;
    const payload = message.payload ?? {};
    // The key list comes FIRST and is never truncated away. `preview_ready`
    // carries several megabytes of events; the truncated body showed only its
    // first key, which is exactly how a reducer reading the wrong key name
    // stays invisible. What the payload CONTAINS is the diagnosis; what it
    // says first is not.
    const keys =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? Object.keys(payload as Record<string, unknown>)
        : [];
    push(
      {
        kind: "state",
        name: String(message.name ?? "<unnamed state>"),
        id: anchor?.id ?? null,
        sinceCommandMs: anchor ? ms - anchor.ms : null,
        detail: `keys=[${keys.join(",")}] ${summarize(payload)}`,
      },
      ms,
    );
    return;
  }

  if (message.type === "trace") {
    push(
      {
        kind: "engine",
        name: String(message.name ?? "<unnamed>"),
        id: typeof message.id === "string" ? message.id : null,
        sinceCommandMs: null,
        detail: `${message.phase ?? "?"} ${summarize({ ms: message.ms, ...(message.detail ? { detail: message.detail } : {}) })}`,
      },
      ms,
    );
    return;
  }

  if (message.type === "ask" || message.type === "fatal") {
    push(
      {
        kind: message.type === "ask" ? "ask" : "fatal",
        name: message.type,
        id: typeof message.id === "string" ? message.id : null,
        sinceCommandMs: null,
        detail: summarize(message),
      },
      ms,
    );
    return;
  }

  if (message.type === "child_exit" || message.type === "child_error") {
    push(
      { kind: "fatal", name: message.type, id: null, sinceCommandMs: null, detail: summarize(message) },
      ms,
    );
  }
}

/** Record a free-form marker -- what the harness uses to name a scenario. */
export function recordNote(text: string): void {
  if (!enabled) return;
  push({ kind: "note", name: "note", id: null, sinceCommandMs: null, detail: text }, now());
}

/** The export (A5): one line per entry, oldest first, plain text. */
export function traceToText(): string {
  const stamp = (ms: number) => `${ms.toFixed(1)}ms`;
  return entries
    .map((entry) => {
      const since = entry.sinceCommandMs === null ? "" : ` (+${stamp(entry.sinceCommandMs)})`;
      const id = entry.id === null ? "" : ` #${entry.id}`;
      return `${entry.seq}\t${stamp(entry.ms)}\t${entry.kind}\t${entry.name}${id}${since}\t${entry.detail}`;
    })
    .join("\n");
}
