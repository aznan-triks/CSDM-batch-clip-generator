/** Segmented's optional `tip`: a hover explanation for the whole control. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Segmented from "../Segmented";

describe("Segmented's optional tip", () => {
  it("renders tip as a native title on the radiogroup", () => {
    render(
      <Segmented
        options={["a", "b"]}
        value="a"
        onChange={() => {}}
        label="Choice"
        tip="Explains the choice"
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Choice" }).title).toBe("Explains the choice");
  });
});
