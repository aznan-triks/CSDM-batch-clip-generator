/**
 * A gauge must be typeable, and the rail must follow what was typed.
 *
 * The window's numbers are seconds and counts: dragging to "7" inside a 1..15
 * range is fiddly, and a range input alone offers no way to type it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NumberField from "../NumberField";
import Slider from "../Slider";

function setup(value = 3) {
  const onChange = vi.fn();
  const utils = render(
    <Slider id="secs" label="Seconds before" value={value} onChange={onChange} min={1} max={15} />,
  );
  return { onChange, ...utils };
}

describe("a gauge can be typed into", () => {
  it("offers a number field beside the rail", () => {
    setup();
    expect(screen.getByRole("spinbutton", { name: /seconds before/i })).toBeTruthy();
  });

  it("reports a typed value the same way a drag does", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole("spinbutton", { name: /seconds before/i }), {
      target: { value: "9" },
    });
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it("clamps a typed value to the range instead of accepting nonsense", () => {
    const { onChange } = setup();
    const field = screen.getByRole("spinbutton", { name: /seconds before/i });
    fireEvent.change(field, { target: { value: "99" } });
    expect(onChange).toHaveBeenLastCalledWith(15);
    fireEvent.change(field, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ignores an empty box rather than reporting NaN", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole("spinbutton", { name: /seconds before/i }), {
      target: { value: "" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resyncs the rail to the typed value", () => {
    const { rerender, container } = setup(3);
    rerender(
      <Slider id="secs" label="Seconds before" value={12} onChange={() => {}} min={1} max={15} />,
    );
    // The fill is handed to CSS as a percentage custom property.
    const row = container.querySelector(".row") as HTMLElement;
    expect(row.style.getPropertyValue("--fill")).toBe(`${((12 - 1) / 14) * 100}%`);
    expect(
      (screen.getByRole("spinbutton", { name: /seconds before/i }) as HTMLInputElement).value,
    ).toBe("12");
  });

  it("renders an optional tip as a title on the row", () => {
    const { container } = render(
      <Slider value={5} onChange={() => {}} min={0} max={10} label="Seconds" tip="Explains the setting" />,
    );
    expect((container.querySelector(".row") as HTMLElement).title).toBe("Explains the setting");
  });
});

describe("NumberField's optional tip", () => {
  it("renders an optional tip as a title on the number input", () => {
    render(<NumberField value={5} onChange={() => {}} min={0} max={10} step={1} label="Seconds" tip="Explains it" />);
    expect(screen.getByLabelText("Seconds").title).toBe("Explains it");
  });
});
