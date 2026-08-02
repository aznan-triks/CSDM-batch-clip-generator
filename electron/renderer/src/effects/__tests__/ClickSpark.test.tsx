/**
 * The click spark's particle count and colour must not drift from the approved effect.
 */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setIntensity } from "../../motion/engine";
import ClickSpark from "../ClickSpark";

describe("ClickSpark", () => {
  beforeEach(() => {
    setIntensity("full");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setIntensity("full");
    document.body.querySelectorAll(".cspark, .cspark-ring").forEach((el) => el.remove());
  });

  it("spawns 6 particles + 1 ring on mousedown, holo-coloured off a button", () => {
    render(<ClickSpark />);
    fireEvent.mouseDown(document.body, { clientX: 40, clientY: 50 });

    expect(document.querySelectorAll(".cspark").length).toBe(6);
    expect(document.querySelectorAll(".cspark-ring").length).toBe(1);
    const spark = document.querySelector(".cspark") as HTMLElement;
    expect(spark.style.getPropertyValue("--sc")).toBe("var(--holo)");
    expect(spark.style.left).toBe("40px");
    expect(spark.style.top).toBe("50px");
  });

  it("colours accent when the mousedown target is a button", () => {
    render(<ClickSpark />);
    const button = document.createElement("button");
    button.className = "btn btn-run";
    document.body.appendChild(button);

    fireEvent.mouseDown(button, { clientX: 10, clientY: 10 });

    const spark = document.querySelector(".cspark") as HTMLElement;
    expect(spark.style.getPropertyValue("--sc")).toBe("var(--gold)");
    button.remove();
  });

  it("spawns nothing under intensity none", () => {
    setIntensity("none");
    render(<ClickSpark />);
    fireEvent.mouseDown(document.body, { clientX: 0, clientY: 0 });
    expect(document.querySelectorAll(".cspark").length).toBe(0);
  });

  it("removes what it spawned after its animation duration", () => {
    render(<ClickSpark />);
    fireEvent.mouseDown(document.body, { clientX: 0, clientY: 0 });
    expect(document.querySelectorAll(".cspark").length).toBe(6);

    vi.advanceTimersByTime(500);

    expect(document.querySelectorAll(".cspark").length).toBe(0);
    expect(document.querySelectorAll(".cspark-ring").length).toBe(0);
  });
});
