import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Card from "../Card";

function stubRect(el: HTMLElement, left: number, top: number) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left, top, width: 200, height: 100, right: left + 200, bottom: top + 100, x: left, y: top, toJSON() {} }),
  });
}

describe("Card's cursor-follow spotlight", () => {
  it("paints --mx/--my as custom properties on mousemove, never a layout style", () => {
    render(
      <Card title="Demo">
        <p>content</p>
      </Card>,
    );
    const card = screen.getByText("Demo").closest(".panel-box") as HTMLElement;
    stubRect(card, 10, 20);
    fireEvent.mouseMove(card, { clientX: 60, clientY: 70 });

    expect(card.style.getPropertyValue("--mx")).toBe("50px");
    expect(card.style.getPropertyValue("--my")).toBe("50px");
    expect(card.style.left).toBe("");
    expect(card.style.top).toBe("");
  });

  it("renders exactly one .spot overlay", () => {
    render(
      <Card title="Demo2">
        <p>content</p>
      </Card>,
    );
    expect(document.querySelectorAll(".spot").length).toBe(1);
  });
});
