import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tab, TabBar } from "../Tab";

function stubRect(el: HTMLElement, left: number, width: number) {
  Object.defineProperty(el, "offsetLeft", { configurable: true, value: left });
  Object.defineProperty(el, "offsetWidth", { configurable: true, value: width });
}

describe("TabBar's sliding indicator", () => {
  it("matches the active tab's measured position and width, minus the slant", () => {
    const { container } = render(
      <TabBar>
        <Tab label="Capture" active onSelect={() => {}} />
        <Tab label="Tags" onSelect={() => {}} />
      </TabBar>,
    );
    const active = screen.getByRole("tab", { name: /capture/i });
    stubRect(active, 40, 130);
    // The effect already ran once on mount, before the stub existed; firing
    // resize re-measures with the stubbed values in place -- jsdom never
    // lays out real boxes, so this is how the formula itself gets exercised.
    window.dispatchEvent(new Event("resize"));

    const ind = container.querySelector(".ind") as HTMLElement;
    expect(ind.style.transform).toBe(`translateX(40px) scaleX(${(130 - 18) / 100})`);
  });

  it("renders exactly one indicator element regardless of tab count", () => {
    const { container } = render(
      <TabBar>
        <Tab label="A" active onSelect={() => {}} />
        <Tab label="B" onSelect={() => {}} />
        <Tab label="C" onSelect={() => {}} />
      </TabBar>,
    );
    expect(container.querySelectorAll(".ind").length).toBe(1);
  });
});
