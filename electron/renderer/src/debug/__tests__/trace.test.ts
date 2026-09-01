import { beforeEach, describe, expect, it } from "vitest";

import {
  TRACE,
  clearTrace,
  disableTrace,
  enableTrace,
  isTracing,
  recordCommand,
  recordIncoming,
  snapshot,
  traceToText,
} from "../trace";

beforeEach(() => {
  disableTrace();
  clearTrace();
});

describe("the switch", () => {
  it("starts off", () => {
    expect(isTracing()).toBe(false);
  });

  it("records nothing while off -- A6, no observable cost", () => {
    recordCommand("connect_db", "1", {});
    expect(snapshot()).toHaveLength(0);
  });

  it("records once on", () => {
    enableTrace();
    recordCommand("connect_db", "1", {});
    expect(snapshot()).toHaveLength(1);
  });
});

describe("outgoing commands -- A2", () => {
  beforeEach(() => enableTrace());

  it("keeps the name, the id and a monotonic stamp", () => {
    recordCommand("start_preview", "7", { cfg: { perspective: "killer" } });
    const [entry] = snapshot();
    expect(entry.kind).toBe("command");
    expect(entry.name).toBe("start_preview");
    expect(entry.id).toBe("7");
    expect(typeof entry.ms).toBe("number");
  });

  it("masks the secret keys instead of writing them out", () => {
    recordCommand("connect_db", "1", { pg: { host: "localhost", pass: "hunter2" } });
    const [entry] = snapshot();
    expect(entry.detail).toContain("localhost");
    expect(entry.detail).not.toContain("hunter2");
    expect(entry.detail).toContain(TRACE.mask);
  });

  it("masks every configured secret key, wherever it is nested", () => {
    recordCommand("save_config", "2", { cfg: { pg_pass: "hunter2", pg_user: "trois" } });
    const [entry] = snapshot();
    expect(entry.detail).not.toContain("hunter2");
    expect(entry.detail).toContain("trois");
  });

  it("truncates a huge payload rather than holding the whole run config", () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 500; i += 1) huge[`key_${i}`] = "x".repeat(50);
    recordCommand("start_run", "3", { cfg: huge });
    const [entry] = snapshot();
    expect(entry.detail.length).toBeLessThanOrEqual(TRACE.detailChars + 1);
  });
});

describe("incoming messages -- A4", () => {
  beforeEach(() => enableTrace());

  it("pairs a result with the command that asked for it", () => {
    recordCommand("connect_db", "1", {});
    recordIncoming({ type: "result", id: "1", ok: true });
    const entry = snapshot()[1];
    expect(entry.kind).toBe("result");
    expect(entry.name).toBe("connect_db");
    expect(entry.sinceCommandMs).not.toBeNull();
    expect(entry.sinceCommandMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a failed result as such, with its reason", () => {
    recordCommand("start_preview", "4", {});
    recordIncoming({ type: "result", id: "4", ok: false, error: "no players selected" });
    const entry = snapshot()[1];
    expect(entry.detail).toContain("no players selected");
  });

  it("dates a state event from the last command in flight", () => {
    recordCommand("start_preview", "5", {});
    recordIncoming({ type: "state", name: "preview_ready", payload: { clips: 3 } });
    const entry = snapshot()[1];
    expect(entry.kind).toBe("state");
    expect(entry.name).toBe("preview_ready");
    expect(entry.sinceCommandMs).not.toBeNull();
  });

  it("keeps a state event that follows no command at all", () => {
    recordIncoming({ type: "state", name: "progress", payload: {} });
    const entry = snapshot()[0];
    expect(entry.name).toBe("progress");
    expect(entry.sinceCommandMs).toBeNull();
  });

  it("carries the engine's own trace lines through under their own kind", () => {
    recordIncoming({ type: "trace", phase: "recv", id: "9", name: "connect_db", ms: 12.5 });
    const entry = snapshot()[0];
    expect(entry.kind).toBe("engine");
    expect(entry.name).toBe("connect_db");
    expect(entry.detail).toContain("recv");
  });

  it("does not record log lines: the console already shows them", () => {
    recordIncoming({ type: "log", message: "hello", level: "ok" });
    expect(snapshot()).toHaveLength(0);
  });
});

describe("the buffer", () => {
  beforeEach(() => enableTrace());

  it("keeps the newest entries and drops the oldest, never growing forever", () => {
    for (let i = 0; i < TRACE.capacity + 25; i += 1) recordCommand("ping", String(i), {});
    const entries = snapshot();
    expect(entries).toHaveLength(TRACE.capacity);
    expect(entries[entries.length - 1].id).toBe(String(TRACE.capacity + 24));
  });

  it("numbers entries in order, so a dropped entry is visible in the export", () => {
    recordCommand("ping", "1", {});
    recordCommand("ping", "2", {});
    const [first, second] = snapshot();
    expect(second.seq).toBe(first.seq + 1);
  });
});

describe("the export -- A5", () => {
  it("writes one line per entry, with the sequence and the kind", () => {
    enableTrace();
    recordCommand("connect_db", "1", {});
    recordIncoming({ type: "result", id: "1", ok: true });
    const text = traceToText();
    const lines = text.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("connect_db");
    expect(text).toContain("command");
    expect(text).toContain("result");
  });
});
