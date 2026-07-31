/**
 * The button's impact feedback.
 *
 * D18 in one line: these layers are the BUTTON saying "I took your click".
 * They are not a weapon sequence, they never call `weapon/controller.ts`, and
 * nothing here can make the window look like a run started. The weapon answers
 * to engine events only.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MOTION } from "../../motion/tokens";
import ActionButton from "../ActionButton";

describe("ActionButton impact feedback", () => {
  it("carries the mock's three effect layers", () => {
    render(<ActionButton label="Preview" variant="preview" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: /preview/i });
    for (const layer of ["bx", "fl", "brs"]) {
      expect(button.querySelector(`.${layer}`), `missing .${layer}`).not.toBeNull();
    }
  });

  it("gives the primary button the spinning ring, and only the primary", () => {
    const { rerender } = render(<ActionButton label="Run" variant="run" onClick={() => {}} />);
    expect(screen.getByRole("button").querySelector(".sb")).not.toBeNull();
    rerender(<ActionButton label="Preview" variant="preview" onClick={() => {}} />);
    expect(screen.getByRole("button").querySelector(".sb")).toBeNull();
  });

  it("wears the mock's variant names, so the mock's rules reach it", () => {
    const cases: [("run" | "preview" | "stop" | "kill"), string][] = [
      ["run", "primary"],
      ["preview", "ghost"],
      ["stop", "danger"],
      ["kill", "danger"],
    ];
    for (const [variant, expected] of cases) {
      const { container, unmount } = render(
        <ActionButton label={variant} variant={variant} onClick={() => {}} />,
      );
      expect(container.querySelector("button")!.className, variant).toContain(expected);
      unmount();
    }
  });

  it("marks the impact on mousedown and clears it on the clock", () => {
    vi.useFakeTimers();
    render(<ActionButton label="Run" variant="run" onClick={() => {}} />);
    const button = screen.getByRole("button");
    fireEvent.mouseDown(button);
    expect(button.className).toContain("hit");
    // Cleared by a timer, never by onfinish: onfinish does not fire while the
    // window is hidden and the class would pile up (CONTEXT_GUIDE section 10).
    act(() => {
      vi.advanceTimersByTime(MOTION.buttonImpact.duration * 1000 + 1);
    });
    expect(button.className).not.toContain("hit");
    vi.useRealTimers();
  });

  it("still sends exactly one command per click, effects or not", () => {
    const onClick = vi.fn();
    render(<ActionButton label="Run" variant="run" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hides every effect layer from assistive technology", () => {
    const { container } = render(<ActionButton label="Run" variant="run" onClick={() => {}} />);
    for (const layer of container.querySelectorAll("span")) {
      expect(layer.getAttribute("aria-hidden"), layer.className).toBe("true");
    }
  });
});
