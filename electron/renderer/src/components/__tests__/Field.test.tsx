import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Field from "../Field";

describe("Field's optional tip", () => {
  it("renders tip as title on both the label and the input", () => {
    render(<Field value="" onChange={() => {}} id="f1" label="Retries" tip="Explains retries" />);
    expect(screen.getByText("Retries").title).toBe("Explains retries");
    expect(screen.getByLabelText("Retries").title).toBe("Explains retries");
  });
});
