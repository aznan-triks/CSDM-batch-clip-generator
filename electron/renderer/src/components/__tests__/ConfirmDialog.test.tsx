/**
 * ConfirmDialog: the reusable destructive-action confirmation (spec Section C).
 *
 * Rendered through a React portal into document.body, so the queries below
 * assert against the whole document rather than the render container.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConfirmDialog from "../ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders its title and message in an alertdialog", () => {
    render(
      <ConfirmDialog title="Delete tag" message="Delete tag X?" onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByRole("alertdialog", { name: "Delete tag" })).toBeTruthy();
    expect(screen.getByText("Delete tag X?")).toBeTruthy();
  });

  it("renders into document.body through a portal", () => {
    render(<ConfirmDialog title="T" message="m" onCancel={() => {}} onConfirm={() => {}} />);
    const dialog = screen.getByRole("alertdialog");
    // The dialog escaped the render container: its backdrop is a direct child
    // of <body>, so the overlay covers the whole window, not just the card.
    expect(document.body.querySelector(".confirm-backdrop")).toBeTruthy();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it("fires onCancel on Cancel and onConfirm on Confirm", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="T" message="m" onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("gives only the Confirm button the danger face when danger is set", () => {
    render(<ConfirmDialog title="T" message="m" onCancel={() => {}} onConfirm={() => {}} danger />);
    const confirm = screen.getByRole("button", { name: /^confirm$/i });
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(confirm.classList.contains("danger")).toBe(true);
    expect(cancel.classList.contains("danger")).toBe(false);
  });

  it("auto-focuses the Cancel button on open (basic focus trap)", () => {
    render(<ConfirmDialog title="T" message="m" onCancel={() => {}} onConfirm={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^cancel$/i }));
  });
});
