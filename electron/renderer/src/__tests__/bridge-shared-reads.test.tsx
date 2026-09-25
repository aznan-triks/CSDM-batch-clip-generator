/**
 * Console lines shown twice outside the exe ("engine ready" x2, each
 * PostgreSQL error x2).
 *
 * Cause: StrictMode (main.tsx) runs every mount effect twice in development,
 * so `hello` and `connect_db` reached the engine twice and each answer was
 * written to the console twice. The fix sits in `runCommand`: a mount-time
 * read that is already in flight is answered by the same promise.
 */
import { act, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeCommand, BridgeMessage } from "../bridge";

function installFakeBridge() {
  const sent: BridgeCommand[] = [];
  const listeners: ((message: BridgeMessage) => void)[] = [];
  window.bridge = {
    send: (command) => void sent.push(command),
    onMessage(cb) {
      listeners.push(cb);
      return () => void listeners.splice(listeners.indexOf(cb), 1);
    },
    pickPath: () => Promise.resolve(null),
    pickSavePath: () => Promise.resolve(null),
    restartEngine: () => Promise.resolve(),
    onFlushRequest: () => () => {},
    setWindowBounds: () => Promise.resolve(),
  };
  const names = () => sent.flatMap((c) => (c.type === "command" ? [c.name] : []));
  const answer = (message: BridgeMessage) => {
    for (const cb of [...listeners]) cb(message);
  };
  return { sent, names, answer };
}

async function freshBridge() {
  vi.resetModules();
  return import("../bridge");
}

describe("mount-time reads under StrictMode", () => {
  beforeEach(() => vi.resetModules());

  it("sends hello and connect_db once although every mount effect runs twice", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();
    function Mount() {
      useEffect(() => {
        runCommand("hello").catch(() => {});
        runCommand("connect_db").catch(() => {});
      }, []);
      return null;
    }
    render(
      <StrictMode>
        <Mount />
      </StrictMode>,
    );
    expect(fake.names()).toEqual(["hello", "connect_db"]);
  });

  it("hands every caller the one answer, then asks again once it has settled", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();
    const first = runCommand("connect_db");
    const second = runCommand("connect_db");
    expect(fake.names()).toEqual(["connect_db"]);
    await act(async () => fake.answer({ type: "result", id: "1", ok: false, error: "PG down" }));
    await expect(first).rejects.toThrow("PG down");
    await expect(second).rejects.toThrow("PG down");
    // A reload after the failure is a new question, not the old answer.
    void runCommand("connect_db").catch(() => {});
    expect(fake.names()).toEqual(["connect_db", "connect_db"]);
  });

  it("never merges commands that act: two RUN clicks send two start_run", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();
    void runCommand("start_run", { cfg: {} });
    void runCommand("start_run", { cfg: {} });
    expect(fake.names()).toEqual(["start_run", "start_run"]);
  });

  it("asks a newly installed bridge even while the old one never answered", async () => {
    installFakeBridge();
    const { runCommand } = await freshBridge();
    void runCommand("hello").catch(() => {});
    const next = installFakeBridge();
    void runCommand("hello").catch(() => {});
    expect(next.names()).toEqual(["hello"]);
  });

  it("keeps reads with different arguments apart", async () => {
    const fake = installFakeBridge();
    const { runCommand } = await freshBridge();
    void runCommand("probe_config_dir");
    void runCommand("probe_config_dir", { target: "D:/elsewhere" });
    expect(fake.names()).toEqual(["probe_config_dir", "probe_config_dir"]);
  });
});
