/**
 * The pipe must carry arguments and hand answers back.
 *
 * `bridge.ts` keeps module state (a counter, a pending map, a one-shot
 * listener install), so every test imports a fresh copy through
 * `vi.resetModules()`. Sharing one instance would let one test's pending
 * command resolve inside the next.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeCommand, BridgeMessage } from "../bridge";

/** A stand-in for what `preload.js` puts on `window`. */
function installFakeBridge() {
  const sent: BridgeCommand[] = [];
  const listeners: ((message: BridgeMessage) => void)[] = [];
  window.bridge = {
    send(command) {
      sent.push(command);
    },
    onMessage(cb) {
      listeners.push(cb);
      return () => {
        listeners.splice(listeners.indexOf(cb), 1);
      };
    },
    pickPath() {
      return Promise.resolve(null);
    },
    pickSavePath() {
      return Promise.resolve(null);
    },
  };
  return {
    sent,
    emit(message: BridgeMessage) {
      for (const cb of [...listeners]) cb(message);
    },
  };
}

async function freshBridge() {
  vi.resetModules();
  return import("../bridge");
}

describe("sendCommand", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("still sends a bare command when given no payload", async () => {
    const fake = installFakeBridge();
    const { sendCommand } = await freshBridge();

    sendCommand("ping");

    expect(fake.sent).toEqual([{ type: "command", id: "1", name: "ping" }]);
  });

  it("spreads the payload alongside the protocol fields", async () => {
    const fake = installFakeBridge();
    const { sendCommand } = await freshBridge();

    sendCommand("connect_db", { pg: { pg_host: "127.0.0.1" } });

    expect(fake.sent[0]).toEqual({
      type: "command",
      id: "1",
      name: "connect_db",
      pg: { pg_host: "127.0.0.1" },
    });
  });

  it("never lets a payload key overwrite type, id or name", async () => {
    const fake = installFakeBridge();
    const { sendCommand } = await freshBridge();

    sendCommand("ping", { id: "hacked", name: "hacked", type: "hacked" });

    expect(fake.sent[0]).toMatchObject({ type: "command", id: "1", name: "ping" });
  });
});

describe("runCommand", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves with the result carrying the same id", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();

    const promise = runCommand("load_config");
    fake.emit({ type: "result", id: "1", ok: true, data: { crf: 18 } });

    await expect(promise).resolves.toMatchObject({ data: { crf: 18 } });
  });

  it("ignores a result meant for another command", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();

    const first = runCommand("load_config");
    const second = runCommand("list_presets");
    fake.emit({ type: "result", id: "2", ok: true, data: { a: 1 } });

    await expect(second).resolves.toMatchObject({ data: { a: 1 } });
    // `first` is still pending: settle it so the test does not leak a promise.
    fake.emit({ type: "result", id: "1", ok: true });
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("rejects with the engine's own sentence when ok is false", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();

    const promise = runCommand("save_config");
    fake.emit({ type: "result", id: "1", ok: false, error: "save_config needs a `cfg` object" });

    await expect(promise).rejects.toThrow("save_config needs a `cfg` object");
  });

  it("rejects at once when the page has no bridge at all", async () => {
    // @ts-expect-error -- a plain browser tab, where preload never ran.
    delete window.bridge;
    const { runCommand } = await freshBridge();

    await expect(runCommand("load_config")).rejects.toThrow(/no engine bridge/);
  });

  it("rejects every command in flight when the engine dies", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();

    const first = runCommand("start_run");
    const second = runCommand("load_config");
    fake.emit({ type: "child_exit", code: 1, signal: null });

    await expect(first).rejects.toThrow(/engine exited/);
    await expect(second).rejects.toThrow(/engine exited/);
  });
});
