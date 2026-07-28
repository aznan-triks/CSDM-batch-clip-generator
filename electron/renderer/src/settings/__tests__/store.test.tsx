/**
 * The settings store: one flat dictionary, keyed exactly like DEFAULT_CONFIG.
 *
 * The window already produces that dictionary (`_collect_config`) and the
 * engine already consumes it end to end, so the renderer invents no contract
 * of its own -- it holds the same shape and hands it back.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAVE_DEBOUNCE_MS, SettingsProvider, useSetting } from "../store";

const commands: { name: string; payload: Record<string, unknown> }[] = [];
let loadResult: () => Promise<{ data: Record<string, unknown> }>;

vi.mock("../../bridge", () => ({
  runCommand: (name: string, payload: Record<string, unknown> = {}) => {
    commands.push({ name, payload });
    if (name === "load_config") return loadResult();
    return Promise.resolve({ type: "result", id: "1", ok: true });
  },
}));

/** A probe that shows one setting and can change it. */
function Probe({ settingKey }: { settingKey: string }) {
  const [value, setValue] = useSetting<number>(settingKey);
  return (
    <button type="button" onClick={() => setValue((value ?? 0) + 1)}>
      {String(value)}
    </button>
  );
}

beforeEach(() => {
  commands.length = 0;
  loadResult = () => Promise.resolve({ data: { crf: 18, framerate: 60 } });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SettingsProvider", () => {
  it("asks the engine for the configuration once, on mount", async () => {
    render(
      <SettingsProvider>
        <Probe settingKey="crf" />
      </SettingsProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("18"));
    expect(commands.filter((c) => c.name === "load_config")).toHaveLength(1);
  });

  it("groups three quick edits into one save carrying the last value", async () => {
    render(
      <SettingsProvider>
        <Probe settingKey="crf" />
      </SettingsProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("18"));

    // One act() per click, because that is what three real clicks are: three
    // events with a render between them. Batching them into a single act()
    // would have the probe read the same stale `value` three times over and
    // measure React's batching rather than the store's grouping.
    const button = screen.getByRole("button");
    act(() => button.click());
    act(() => button.click());
    act(() => button.click());
    expect(commands.filter((c) => c.name === "save_config")).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    const saves = commands.filter((c) => c.name === "save_config");
    expect(saves).toHaveLength(1);
    expect((saves[0].payload.cfg as Record<string, unknown>).crf).toBe(21);
  });

  it("never saves the configuration it has just loaded", async () => {
    render(
      <SettingsProvider>
        <Probe settingKey="crf" />
      </SettingsProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("18"));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 3);
    });
    expect(commands.filter((c) => c.name === "save_config")).toHaveLength(0);
  });

  it("never writes the file when the load it never got would be overwritten", async () => {
    // save_config replaces the file wholesale. After a failed load the store
    // holds nothing, so writing would swap every saved key for the one just
    // edited -- the corrupted-config case turning into a wiped config.
    loadResult = () => Promise.reject(new Error("config file is not valid JSON"));
    render(
      <SettingsProvider>
        <Probe settingKey="crf" />
      </SettingsProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("undefined"));

    act(() => screen.getByRole("button").click());
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 3);
    });

    expect(commands.filter((c) => c.name === "save_config")).toHaveLength(0);
  });

  it("stays mounted and readable when the engine cannot answer", async () => {
    loadResult = () => Promise.reject(new Error("engine exited (code=1, signal=null)"));
    render(
      <SettingsProvider>
        <Probe settingKey="crf" />
      </SettingsProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("undefined"));
  });
});
