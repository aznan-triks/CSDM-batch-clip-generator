/**
 * The tab nav must not lose its aria-current wiring or the mock's `.hud-nav` vocabulary.
 */
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

  it("wears the mock's nav vocabulary, so the mock's rules can reach it", () => {
    // jsdom does no cascade and no pseudo-element style, so the rendered look
    // cannot be asserted here. What CAN be asserted is the join: the mock's
    // rules are keyed on these class names, and without them every nav rule --
    // the topographic texture, the accent hairline, the pill -- addresses
    // nothing. The rendered check is the on-screen probe.
    const { container } = render(<HudNav tabs={TABS} active="capture" onSelect={() => {}} />);
    for (const selector of [
      ".hud-nav",
      ".hud-inner",
      ".brand",
      ".mark",
      ".navtools",
      ".navtools .p",
    ]) {
      expect(container.querySelector(selector), `missing ${selector}`).not.toBeNull();
    }
  });

  it("shows the running build beside the brand when given a version", () => {
    const { container } = render(
      <HudNav tabs={TABS} active="capture" onSelect={() => {}} version="3.0.8" />,
    );
    const chip = container.querySelector(".brand-version");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("3.0.8");
    expect(chip?.getAttribute("title")).toBe("Version 3.0.8");
  });

  it("renders no version chip before the engine names itself", () => {
    const { container } = render(<HudNav tabs={TABS} active="capture" onSelect={() => {}} />);
    expect(container.querySelector(".brand-version")).toBeNull();
  });
});
