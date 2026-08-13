/** PathField's optional `tip`, and that it never overwrites Browse's own conditional title. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PathField from "../PathField";

describe("PathField's optional tip", () => {
  it("renders tip as title on both the label and the text input", () => {
    render(<PathField value="" onChange={() => {}} id="p1" label="Config dir" tip="Explains this path" />);
    expect(screen.getByText("Config dir").title).toBe("Explains this path");
    expect(screen.getByDisplayValue("").title).toBe("Explains this path");
  });

  it("does not overwrite the Browse button's own conditional title", () => {
    render(<PathField value="" onChange={() => {}} id="p1" label="Config dir" tip="Explains this path" mode="file" />);
    expect(screen.getByRole("button", { name: /browse/i }).title).toBe("Opens a native file picker");
  });
});
