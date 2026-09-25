/**
 * The console's E10 parity tools: the search walk (J4–J7), saving the log
 * (J14), exporting the preview clip list (K1–K4), the CS2 injection preview
 * (M8) and the self-removing status line (P4).
 *
 * The bridge is mocked: `runCommand` answers the way `csdm/bridge/host.py`
 * does for `export_preview` / `injection_preview`. The typewriter is held
 * still so every line is complete the moment it arrives.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeMessage } from "../../bridge";
import LogConsole, { LOG_CONSOLE } from "../LogConsole";

const listeners = new Set<(message: BridgeMessage) => void>();
const runCommand = vi.fn();

vi.mock("../../bridge", () => ({
  onMessage: (cb: (message: BridgeMessage) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  send: () => {},
  runCommand: (...args: unknown[]) => runCommand(...args),
}));

vi.mock("../../settings/store", () => ({
  useAllSettings: () => ({ recsys: "HLAE" }),
}));

vi.mock("../useTypewriter", () => ({
  useTypewriter: () => () => Infinity,
}));

function emit(message: BridgeMessage): void {
  for (const cb of listeners) cb(message);
}

function log(message: string) {
  act(() => emit({ type: "log", message, level: "info" }));
}

function lineTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("#log > div:not(.promptline)")].map((d) => d.textContent ?? "");
}

let downloads: string[];

beforeEach(() => {
  listeners.clear();
  runCommand.mockReset();
  downloads = [];
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /Export/ }));
}

describe("console search walk (J4–J7)", () => {
  it("counts the matches, marks them, and walks them with Enter / Shift+Enter", () => {
    const { container } = render(<LogConsole />);
    log("alpha one");
    log("beta");
    log("alpha two");
    const input = screen.getByLabelText(/Search/i);
    fireEvent.change(input, { target: { value: "alpha" } });

    expect(screen.getByText("1/2")).toBeTruthy();
    expect(container.querySelectorAll("mark.log-hit")).toHaveLength(2);
    expect(container.querySelector(".log-search-cur")?.textContent).toContain("alpha one");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeTruthy();
    expect(container.querySelector(".log-search-cur")?.textContent).toContain("alpha two");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("1/2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("says when nothing matches", () => {
    render(<LogConsole />);
    log("alpha");
    fireEvent.change(screen.getByLabelText(/Search/i), { target: { value: "zzz" } });
    expect(screen.getByText("0 results")).toBeTruthy();
  });

  it("Esc closes the search and brings every line back", () => {
    const { container } = render(<LogConsole />);
    log("alpha");
    log("beta");
    const input = screen.getByLabelText(/Search/i);
    fireEvent.change(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(lineTexts(container)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Close search" })).toBeNull();
  });

  it("Ctrl+F puts the cursor in the search box", () => {
    render(<LogConsole />);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText(/Search/i));
  });
});

describe("console exports (J14, K1–K4) and injection preview (M8)", () => {
  it("saves the log as a text file and says so in a line that leaves by itself", () => {
    vi.useFakeTimers();
    const { container } = render(<LogConsole />);
    log("engine ready");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Console log, Text (.txt)" }));

    expect(downloads).toEqual([LOG_CONSOLE.logFileName]);
    const flash = container.querySelector('[data-action="P4"]');
    expect(flash?.textContent).toContain("Log saved");
    act(() => {
      vi.advanceTimersByTime(LOG_CONSOLE.flashMs);
    });
    expect(container.querySelector('[data-action="P4"]')).toBeNull();
    expect(lineTexts(container).join()).toContain("engine ready");
  });

  it("exports the preview clip list the engine renders", async () => {
    runCommand.mockResolvedValue({
      id: "1",
      ok: true,
      data: { content: "{}", filename: "csdm_preview.json", mime: "application/json", clips: 2 },
    });
    render(<LogConsole />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview clips, JSON (.json)" }));

    expect(runCommand).toHaveBeenCalledWith("export_preview", { format: "json" });
    await waitFor(() => expect(downloads).toEqual(["csdm_preview.json"]));
    expect(await screen.findByText(/Preview exported \(2 clips\)/)).toBeTruthy();
  });

  it("shows the engine's reason when there is no preview to export", async () => {
    runCommand.mockRejectedValue(new Error("Run a PREVIEW first: there is no clip list to export yet."));
    render(<LogConsole />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview clips, HTML (.html)" }));

    expect(await screen.findByText(/Run a PREVIEW first/)).toBeTruthy();
    expect(downloads).toEqual([]);
  });

  it("writes the CS2 injection preview into the console, headings apart", async () => {
    runCommand.mockResolvedValue({
      id: "1",
      ok: true,
      lines: [
        ["HLAE extraArgs:", "key"],
        ["  -novid", "val"],
      ],
    });
    const { container } = render(<LogConsole />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "CS2 injection preview" }));

    expect(runCommand).toHaveBeenCalledWith("injection_preview", { cfg: { recsys: "HLAE" } });
    await waitFor(() => expect(lineTexts(container).join("\n")).toContain("-novid"));
    expect(container.querySelector(".line-key")?.textContent).toContain("HLAE extraArgs:");
  });
});
