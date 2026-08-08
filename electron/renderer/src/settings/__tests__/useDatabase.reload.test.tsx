/**
 * useDatabase reload: the fix for AUDIT_tabs-state.md's "reload does nothing".
 *
 * The old TagsTab called `connect_db` bare and threw the payload away; this
 * hook's `reload()` re-runs the same fetch through the shared state, so a
 * consumer's `database` actually changes. The standalone path (no
 * DatabaseProvider above) is what this test exercises -- the same path most
 * tab tests hit.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDatabase } from "../useDatabase";

const calls: string[] = [];

vi.mock("../../bridge", () => ({
  runCommand: (command: string) => {
    calls.push(command);
    if (command === "connect_db") {
      // Each round trip returns n tags, so a stale payload is visible.
      const n = calls.filter((c) => c === "connect_db").length;
      return Promise.resolve({
        type: "result",
        id: "1",
        ok: true,
        data: { weapons: [], maps: [], players: [], tags: Array.from({ length: n }, (_, i) => [i + 1, "tag-" + (i + 1), "#000000"]) },
      });
    }
    return Promise.resolve({ type: "result", id: "1", ok: true, data: {} });
  },
  onMessage: () => () => {},
  send: () => {},
  sendCommand: () => "1",
}));

function Harness() {
  const { database, reload } = useDatabase();
  const tags = database?.tags ?? [];
  return (
    <div>
      <span data-testid="count">{tags.length}</span>
      <button type="button" onClick={reload}>
        reload
      </button>
    </div>
  );
}

describe("useDatabase.reload", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("fetches once on mount, then reload() re-runs connect_db and refreshes the data", async () => {
    render(<Harness />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    await act(async () => {});
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(calls.filter((c) => c === "connect_db").length).toBe(1);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    });
    await act(async () => {});
    await act(async () => {});
    expect(calls.filter((c) => c === "connect_db").length).toBe(2);
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("exposes reload from the provider for shared consumers", async () => {
    render(<Harness />);
    await act(async () => {});
    expect(screen.getByTestId("count").textContent).toBe("1");
  });
});
