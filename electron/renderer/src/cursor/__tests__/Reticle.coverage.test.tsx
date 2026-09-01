/**
 * The crosshair survives a walk across a card.
 *
 * The reported symptom (2026-09-02) was "the crosshair keeps getting replaced
 * by the cursor". The cause was an allowlist of thirteen BACKGROUND classes:
 * every label, glyph, value, span and checkbox inside a card is none of those
 * names, so crossing one card made the reticle blink out and back a dozen
 * times.
 *
 * This test walks a realistic card -- the same element types the real cards
 * render -- and demands the reticle stay on for every one of them. It is the
 * other end of `Reticle.selectors.test.ts`: that one proves the short list of
 * system-cursor surfaces is not stale, this one proves nothing else joined it.
 */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Reticle from "../Reticle";

/** Build one element, attached inside a card, and return it. */
function mount(html: string): Element {
  const card = document.createElement("div");
  card.className = "sec";
  card.innerHTML = html;
  document.body.appendChild(card);
  return card.firstElementChild!;
}

afterEach(() => {
  document.body.classList.remove("customcursor");
  document.querySelectorAll(".sec, .console").forEach((node) => node.remove());
});

describe("the reticle stays on across a card's insides", () => {
  const insides: Array<[string, string]> = [
    ["a field label", '<label class="lab">Retries</label>'],
    ["a card title", '<h5 class="sh"><span class="t">PLAYERS</span></h5>'],
    ["a glyph", '<span class="gl"><svg class="ic"><path /></svg></span>'],
    ["a stat value", '<div class="st"><span class="k">KILLS</span><span class="v">12</span></div>'],
    ["a checkbox box", '<span class="excl"><span class="box"></span></span>'],
    ["a player pill", '<div class="pl"><span class="av"></span><b>trois</b></div>'],
    ["a bare paragraph", "<p>Loading filters...</p>"],
    ["the card's scroller", '<div class="sb-scroll"></div>'],
  ];

  for (const [what, html] of insides) {
    it(`stays on over ${what}`, () => {
      const node = mount(html);
      render(<Reticle />);

      // Deepest child, exactly where a real pointer lands.
      let target: Element = node;
      while (target.firstElementChild) target = target.firstElementChild;
      fireEvent.mouseMove(target, { clientX: 40, clientY: 40 });

      expect(document.body.classList.contains("customcursor"), `${what} turned the crosshair off`).toBe(true);
    });
  }
});

describe("the four system-cursor surfaces still win", () => {
  const natives: Array<[string, string]> = [
    ["a text field", '<input class="fld" />'],
    ["a tab", '<button class="tab"><span>CAPTURE</span></button>'],
    ["the drag handle", '<span class="drag-handle">\u283f</span>'],
    ["the resize handle", '<span class="react-resizable-handle"><i></i></span>'],
  ];

  for (const [what, html] of natives) {
    it(`gives the system cursor back over ${what}`, () => {
      const node = mount(html);
      render(<Reticle />);

      let target: Element = node;
      while (target.firstElementChild) target = target.firstElementChild;
      fireEvent.mouseMove(target, { clientX: 40, clientY: 40 });

      expect(document.body.classList.contains("customcursor"), `${what} kept the crosshair`).toBe(false);
    });
  }
});
