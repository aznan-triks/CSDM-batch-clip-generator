/**
 * The chip's selected face.
 *
 * The mock owns `.chip.on` -- lime fill, lime border, dark-green ink -- and
 * Chip.css deliberately restates none of it. The component was writing
 * `chip-selected` instead, a class with no rule anywhere, so a picked weapon,
 * kill filter, map or video preset looked exactly like an unpicked one across
 * all 27 call sites. This asserts the class the stylesheet can actually reach.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Chip from "../Chip";

describe("Chip wears the mock's own selected class", () => {
  it("carries `on` when selected, which is what .chip.on styles", () => {
    render(<Chip label="AWP" selected onToggle={() => {}} />);
    const chip = screen.getByRole("button", { name: "AWP" });
    expect(chip.classList.contains("chip")).toBe(true);
    expect(chip.classList.contains("on")).toBe(true);
  });

  it("never emits `chip-selected`, a class no stylesheet defines", () => {
    render(<Chip label="AWP" selected onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "AWP" }).className).not.toContain("chip-selected");
  });

  it("stays a bare chip when it is not selected", () => {
    render(<Chip label="AWP" onToggle={() => {}} />);
    const chip = screen.getByRole("button", { name: "AWP" });
    expect(chip.classList.contains("chip")).toBe(true);
    expect(chip.classList.contains("on")).toBe(false);
  });

  it("keeps saying so to a screen reader, which the class change must not cost", () => {
    render(<Chip label="AWP" selected onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "AWP" }).getAttribute("aria-pressed")).toBe("true");
  });
});
