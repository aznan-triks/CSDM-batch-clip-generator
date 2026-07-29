import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ErrorBoundary from "../ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>fine</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("catches a render error instead of unmounting the whole tree to a blank page", () => {
    // React logs the caught error to the console by default; silence it so
    // the expected-crash test doesn't read as a real failure in CI output.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something crashed")).toBeTruthy();
    expect(screen.getByText("kaboom")).toBeTruthy();
    spy.mockRestore();
  });
});
