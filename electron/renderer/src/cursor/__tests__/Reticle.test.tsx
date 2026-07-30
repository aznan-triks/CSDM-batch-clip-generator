import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Reticle from "../Reticle";

describe("Reticle", () => {
  afterEach(() => {
    document.body.classList.remove("customcursor");
  });

  it("paints position via custom properties, never a layout style, over the background", () => {
    const { container } = render(<Reticle />);
    const el = container.querySelector(".reticle") as HTMLElement;

    fireEvent.mouseMove(window, { clientX: 100, clientY: 80 });

    expect(el.style.getPropertyValue("--cx")).toBe("100px");
    expect(el.style.getPropertyValue("--cy")).toBe("80px");
    expect(el.style.left).toBe("");
    expect(el.style.top).toBe("");
    expect(document.body.classList.contains("customcursor")).toBe(true);
  });

  it("snaps to a button's size and hides the center dot", () => {
    const button = document.createElement("button");
    button.className = "btn btn-run";
    document.body.appendChild(button);
    Object.defineProperty(button, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40, x: 0, y: 0, toJSON() {} }),
    });

    const { container } = render(<Reticle />);
    const el = container.querySelector(".reticle") as HTMLElement;
    fireEvent.mouseMove(button, { clientX: 50, clientY: 20 });

    expect(el.classList.contains("snap")).toBe(true);
    expect(el.style.getPropertyValue("--cw")).toBe("110px");
    expect(el.style.getPropertyValue("--ch")).toBe("50px");
    button.remove();
  });

  it("hides the custom cursor over a real widget (an input)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    render(<Reticle />);

    fireEvent.mouseMove(input, { clientX: 5, clientY: 5 });

    expect(document.body.classList.contains("customcursor")).toBe(false);
    input.remove();
  });

  it("hides the custom cursor when the pointer leaves the document", () => {
    render(<Reticle />);
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    expect(document.body.classList.contains("customcursor")).toBe(true);

    fireEvent.mouseLeave(document);

    expect(document.body.classList.contains("customcursor")).toBe(false);
  });
});
