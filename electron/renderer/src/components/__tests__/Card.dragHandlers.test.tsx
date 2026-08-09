/**
 * react-grid-layout's DraggableCore wires whole-card drag by cloning the
 * child it's given with onMouseDown/onMouseUp/onTouchEnd props (see
 * node_modules/react-draggable's DraggableCore.render(), which clones
 * RGL's <Resizable> with these three handlers; react-resizable's
 * Resizable.render() then clones ITS child -- the <Card> SectionList
 * renders -- forwarding any prop not on its own known-prop list, which
 * includes these three). Card must accept and forward them onto its
 * `<section>`, or RGL's drag never reaches the DOM (block-grid v3, Task 5
 * finding: the live `<section>`'s React Fiber props showed no
 * `onMouseDown` at all).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Card from "../Card";

describe("Card forwards react-grid-layout's DraggableCore handlers", () => {
  it("calls onMouseDown/onMouseUp/onTouchEnd passed as props when fired on the section", () => {
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    const onTouchEnd = vi.fn();
    render(
      <Card title="Demo" onMouseDown={onMouseDown} onMouseUp={onMouseUp} onTouchEnd={onTouchEnd}>
        body
      </Card>,
    );
    const card = screen.getByText("Demo").closest(".sec") as HTMLElement;

    fireEvent.mouseDown(card);
    fireEvent.mouseUp(card);
    fireEvent.touchEnd(card);

    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onMouseUp).toHaveBeenCalledTimes(1);
    expect(onTouchEnd).toHaveBeenCalledTimes(1);
  });
});
