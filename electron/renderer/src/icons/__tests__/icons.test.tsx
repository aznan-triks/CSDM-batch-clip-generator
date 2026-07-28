/**
 * D14: every menu and every button carries its own glyph.
 *
 * The register is "solid, thick, geometric, chamfered -- never a thin
 * outline", so the test refuses a `stroke`: an outlined glyph is the exact
 * thing that was rejected, and it is checkable.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ICONS } from "../index";
import { TABS } from "../../shell/tabs";

describe("ICONS", () => {
  it("covers the four tabs and the four action buttons", () => {
    for (const name of ["capture", "tags", "video", "settings",
                        "run", "preview", "stop", "kill"]) {
      expect(ICONS).toHaveProperty(name);
    }
  });

  it("gives every tab an icon that exists", () => {
    for (const tab of TABS) {
      expect(ICONS).toHaveProperty(tab.icon);
    }
  });

  it("draws every glyph filled, never outlined", () => {
    for (const [name, Icon] of Object.entries(ICONS)) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector("svg");
      expect(svg, name).not.toBeNull();
      expect(svg!.getAttribute("fill"), name).toBe("currentColor");
      expect(svg!.querySelector("[stroke]"), `${name} must not be outlined`).toBeNull();
      expect(svg!.innerHTML.trim().length, `${name} must draw something`).toBeGreaterThan(0);
      unmount();
    }
  });

  it("hides every glyph from assistive technology -- the label carries the meaning", () => {
    for (const [name, Icon] of Object.entries(ICONS)) {
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector("svg")!.getAttribute("aria-hidden"), name).toBe("true");
      unmount();
    }
  });
});
