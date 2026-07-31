/**
 * The console's titled header and its prompt line.
 *
 * The prompt is the mock's shape without the mock's fiction: the mock types a
 * fake command into it, and this window has no command line to type into.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LogConsole from "../LogConsole";

describe("LogConsole", () => {
  it("wears the mock's titled header", () => {
    const { container } = render(<LogConsole />);
    const head = container.querySelector(".ch");
    expect(head, "no .ch header").not.toBeNull();
    expect(head!.textContent).toMatch(/console/i);
  });

  it("keeps its working tools inside that header", () => {
    const { container } = render(<LogConsole />);
    const tools = container.querySelector(".ch .tools");
    expect(tools, "the toolbar left the header").not.toBeNull();
    expect(tools!.querySelector("input"), "no search field").not.toBeNull();
  });

  it("ends on a prompt line with a blinking caret", () => {
    const { container } = render(<LogConsole />);
    const body = container.querySelector(".body")!;
    expect(body.lastElementChild?.className).toBe("promptline");
    expect(container.querySelector(".prompt")?.textContent).toContain("csdm>");
    expect(container.querySelector(".cur"), "no caret").not.toBeNull();
  });

  it("keeps the prompt inert -- it is not an input", () => {
    const { container } = render(<LogConsole />);
    const prompt = container.querySelector(".promptline")!;
    expect(prompt.querySelector("input")).toBeNull();
    expect(prompt.getAttribute("contenteditable")).toBeNull();
    expect(prompt.textContent!.trim()).toBe("csdm>");
  });
});
