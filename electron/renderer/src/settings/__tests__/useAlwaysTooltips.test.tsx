import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Field from "../../components/Field";
import Slider from "../../components/Slider";
import PathField from "../../components/PathField";
import FilterRow from "../FilterRow";
import { SettingsProvider } from "../store";
import { AlwaysTooltipsProvider, useAlwaysTooltips } from "../useAlwaysTooltips";

vi.mock("../../bridge", () => ({
  runCommand: () => Promise.resolve({ type: "result", id: "1", ok: true, data: {} }),
  onMessage: () => () => {},
  onFlushRequest: () => () => {},
  send: () => {},
  sendCommand: () => "1",
  pickPath: () => Promise.resolve(null),
}));

function Consumer() {
  const always = useAlwaysTooltips();
  return <div data-testid="val">{always ? "yes" : "no"}</div>;
}

const DEF = {
  key: "kill_mod_wall_bang",
  label: "WALLBANG:",
  tip: "Kill through a wall.",
  category: "mods" as const,
  hidden: false,
};

describe("useAlwaysTooltips", () => {
  it("defaults to false when outside provider", () => {
    render(<Consumer />);
    expect(screen.getByTestId("val").textContent).toBe("no");
  });

  it("returns true when inside AlwaysTooltipsProvider with true", () => {
    render(
      <AlwaysTooltipsProvider value={true}>
        <Consumer />
      </AlwaysTooltipsProvider>
    );
    expect(screen.getByTestId("val").textContent).toBe("yes");
  });

  it("renders persistent tips on Field when alwaysShow is true", () => {
    const { rerender } = render(
      <AlwaysTooltipsProvider value={false}>
        <Field id="test-fld" label="Speed" tip="Controls execution speed" value="5" onChange={() => {}} />
      </AlwaysTooltipsProvider>
    );
    expect(screen.queryByText("Controls execution speed")).toBeNull();

    rerender(
      <AlwaysTooltipsProvider value={true}>
        <Field id="test-fld" label="Speed" tip="Controls execution speed" value="5" onChange={() => {}} />
      </AlwaysTooltipsProvider>
    );
    expect(screen.getByText("Controls execution speed")).toBeTruthy();
  });

  it("renders persistent tips on Slider when alwaysShow is true", () => {
    render(
      <AlwaysTooltipsProvider value={true}>
        <Slider label="Volume" tip="Sound output volume" min={0} max={100} value={50} onChange={() => {}} />
      </AlwaysTooltipsProvider>
    );
    expect(screen.getByText("Sound output volume")).toBeTruthy();
  });

  it("renders persistent tips on PathField when alwaysShow is true", () => {
    render(
      <AlwaysTooltipsProvider value={true}>
        <PathField label="Directory" tip="Where clips are saved" value="/tmp" onChange={() => {}} />
      </AlwaysTooltipsProvider>
    );
    expect(screen.getByText("Where clips are saved")).toBeTruthy();
  });

  it("renders filter row tip on FilterRow when alwaysShow is true", () => {
    render(
      <SettingsProvider>
        <AlwaysTooltipsProvider value={true}>
          <FilterRow def={DEF} />
        </AlwaysTooltipsProvider>
      </SettingsProvider>
    );
    expect(screen.getByText("Kill through a wall.")).toBeTruthy();
  });
});
