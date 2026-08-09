/**
 * A card sized by the grid must scroll its own body rather than spill past
 * its rectangle: the 3.2.3 grid cut three cards' content off at the bottom of
 * the pane with no way to reach it (capture 2026-08-09).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Card from "../Card";

describe("Card body overflow", () => {
  it("marks the scrolling body so CSS can bound it", () => {
    const { container } = render(<Card title="T">content</Card>);
    const body = container.querySelector(".sb");
    expect(body).not.toBeNull();
    expect(body?.classList.contains("sb-scroll")).toBe(true);
  });

  it("no longer renders its own resize corner", () => {
    const { container } = render(<Card title="T">content</Card>);
    expect(container.querySelector(".resize-br")).toBeNull();
  });
});
