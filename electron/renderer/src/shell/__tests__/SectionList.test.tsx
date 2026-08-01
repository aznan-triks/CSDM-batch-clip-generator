import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const state: Record<string, unknown> = {};

// A reactive stub: SectionList must actually re-render when a card is
// toggled or dragged, so the mock needs real React state, not a plain
// object mutation (unlike sectionLayout.test.ts, which drives the hook
// directly with renderHook + manual rerender()).
vi.mock("../../settings/store", () => ({
  useSetting: (key: string) => {
    const [value, setValue] = useState(state[key]);
    const set = (next: unknown) => {
      state[key] = next;
      setValue(next);
    };
    return [value, set];
  },
}));

import Card from "../../components/Card";
import SectionList from "../SectionList";

function sections() {
  return [
    { id: "a", element: <Card title="A">body-a</Card> },
    { id: "b", element: <Card title="B">body-b</Card> },
  ];
}

describe("SectionList", () => {
  it("renders every section's title and body", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("body-a")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("collapsing a card through its header hides only its own body", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    fireEvent.click(screen.getByText("A").closest("button") as HTMLElement);
    expect(screen.queryByText("body-a")).toBeNull();
    expect(screen.getByText("body-b")).toBeTruthy();
  });

  it("gives every section a labelled drag handle", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={sections()} />);
    expect(screen.getByLabelText("drag-a")).toBeTruthy();
    expect(screen.getByLabelText("drag-b")).toBeTruthy();
  });

  it("renders an empty registry gracefully", () => {
    delete state.ui_sections;
    render(<SectionList tabId="capture" sections={[]} />);
  });
});
