/**
 * The recorder writes to the recorder, never to the console.
 *
 * Found the hard way on 2026-09-01: `narrate`'s default branch prints
 * `JSON.stringify(message)` for any type it has not heard of -- a deliberate
 * choice so a new engine event cannot go unnoticed -- and the new `trace`
 * type fell straight into it. The console filled with raw protocol JSON, the
 * one thing CONTEXT_GUIDE forbids reaching the screen.
 *
 * The default branch is right and stays. This is the pairing rule it implies:
 * a message type that must NOT be narrated has to say so explicitly.
 */
import { describe, expect, it } from "vitest";

import { narrate } from "../../shell/consoleNarrative";
import type { BridgeMessage } from "../../bridge";

const traceLine: BridgeMessage = {
  type: "trace",
  phase: "recv",
  id: "12",
  name: "connect_db",
  ms: 0,
  detail: "pg={host,port,user,pass=***,db}",
};

describe("a trace line", () => {
  it("produces no console line at all", () => {
    expect(narrate(traceLine)).toBeNull();
  });

  it("never leaks the protocol type string onto the screen", () => {
    const narrated = narrate(traceLine);
    const text = narrated?.runs.map(([piece]) => piece).join("") ?? "";
    expect(text).not.toContain("trace");
    expect(text).not.toContain("{");
  });

  it("still narrates an unknown type, so a new engine event cannot go unnoticed", () => {
    const unknown = { type: "something_new_the_engine_grew" } as unknown as BridgeMessage;
    expect(narrate(unknown)).not.toBeNull();
  });
});
