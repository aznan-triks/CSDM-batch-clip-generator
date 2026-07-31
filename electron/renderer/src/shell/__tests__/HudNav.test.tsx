import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HudNav from "../HudNav";

const TABS = [
  { id: "capture", label: "Capture", icon: <span>C</span> },
  { id: "tags", label: "Tags", icon: <span>T</span> },
];

describe("HudNav", () => {
  it("renders one button per tab, marking the active one", () => {
    render(<HudNav tabs={TABS} active="tags" onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: /capture/i }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("tab", { name: /tags/i }).getAttribute("aria-current")).toBe("true");
  });

  it("calls onSelect with the clicked tab's id", () => {
    const onSelect = vi.fn();
    render(<HudNav tabs={TABS} active="capture" onSelect={onSelect} />);
    screen.getByRole("tab", { name: /tags/i }).click();
    expect(onSelect).toHaveBeenCalledWith("tags");
  });

  it("mounts its own grid-area root, .hud-nav", () => {
    const { container } = render(<HudNav tabs={TABS} active="capture" onSelect={() => {}} />);
    expect(container.querySelector(".hud-nav")).not.toBeNull();
  });
});
