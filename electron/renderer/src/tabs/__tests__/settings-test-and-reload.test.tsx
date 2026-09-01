/**
 * "Test & Reload" has to reload, not just test.
 *
 * It was calling `connect_db` on its own and dropping the answer on the floor:
 * the shared `DatabaseProvider` -- the thing every other tab reads its players,
 * weapons, maps and tags from -- was never told, so nothing anywhere changed.
 * The button reported "Connected" and the window kept the list it was opened
 * with (AUDIT_retours_ui_8_points.md, ecart E1).
 *
 * The claim under test is therefore not "a command was sent" (one always was)
 * but "the SHARED state was refreshed".
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { SettingsProvider } from "../../settings/store";
import { DatabaseProvider } from "../../settings/useDatabase";
import SettingsTab from "../SettingsTab";

interface SentCommand { type: string; id: string; name: string }

let sent: SentCommand[] = [];
/** Flipped by a test to make the engine refuse from that point on. */
let engineAccepts = true;

/**
 * ONE pipe for the whole file, installed once.
 *
 * `bridge.ts` installs its result router on the first `runCommand` and keeps
 * that subscription for the life of the module. Replacing `window.bridge`
 * between tests would leave the router listening to the previous one, and
 * every result would then be dropped -- a failure that looks exactly like the
 * bug under test. Reset the recording, not the pipe.
 */
function installPipe() {
  const listeners = new Set<(message: unknown) => void>();
  const reply = (command: SentCommand) => {
    const message = engineAccepts
      ? {
          type: "result",
          id: command.id,
          ok: true,
          data: { weapons: [], maps: [], players: [], tags: [] },
        }
      : { type: "result", id: command.id, ok: false, error: "connection refused" };
    for (const cb of [...listeners]) cb(message);
  };
  window.bridge = {
    send(command: SentCommand) {
      sent.push(command);
      // Answer on a later turn, as a real engine does -- an answer delivered
      // inside `send` would resolve the promise before the caller has stored
      // it, which no real round trip ever does.
      queueMicrotask(() => reply(command));
    },
    onMessage(cb: (message: unknown) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    pickPath: () => Promise.resolve(null),
    pickSavePath: () => Promise.resolve(null),
    restartEngine: () => Promise.resolve(),
    setWindowBounds: () => Promise.resolve(),
  } as unknown as typeof window.bridge;
}

installPipe();

const connectCalls = () => sent.filter((c) => c.name === "connect_db").length;

function renderTab(): ReturnType<typeof render> {
  const tree: ReactElement = (
    <SettingsProvider>
      <DatabaseProvider>
        <SettingsTab />
      </DatabaseProvider>
    </SettingsProvider>
  );
  return render(tree);
}

beforeEach(() => {
  sent = [];
  engineAccepts = true;
});

describe("Test & Reload", () => {
  it("asks the shared store to refetch, on top of its own connection test", async () => {
    const { container } = renderTab();
    await waitFor(() => expect(connectCalls()).toBeGreaterThanOrEqual(1));
    const beforeClick = connectCalls();

    const button = container.querySelector('[data-action="M10"]') as HTMLElement;
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button);
    });

    // Two: the direct test carrying the fields being typed right now, and the
    // provider's own refetch that every other tab is subscribed to. One alone
    // is the bug.
    await waitFor(() => expect(connectCalls()).toBe(beforeClick + 2));
  });

  it("still says what happened", async () => {
    const { container } = renderTab();
    const button = container.querySelector('[data-action="M10"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() =>
      expect(container.querySelector(".settings-db-status")?.textContent).toBe("Connected"),
    );
  });

  it("does not refetch when the connection test failed", async () => {
    const { container } = renderTab();
    await waitFor(() => expect(connectCalls()).toBeGreaterThanOrEqual(1));
    const beforeClick = connectCalls();

    // From here on the engine refuses. Refetching after a refusal would
    // replace a usable list with an error for no reason.
    engineAccepts = false;

    const button = container.querySelector('[data-action="M10"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(connectCalls()).toBe(beforeClick + 1));
  });
});
