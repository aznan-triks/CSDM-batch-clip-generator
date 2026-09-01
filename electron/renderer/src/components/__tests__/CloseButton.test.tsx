/**
 * One remove control, and nothing drawing its own.
 *
 * Three of them had been written separately (AUDIT_retours_ui_8_points.md,
 * ecart E4) and had drifted apart in glyph, tag, size and shape, because
 * nothing tied them together and nothing failed when they diverged. The
 * component is half the fix; this file is the other half -- a fourth one
 * cannot appear quietly.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CloseButton, { CLOSE_GLYPH, ChipPair } from "../CloseButton";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC = path.resolve(HERE, "..", "..");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsxFiles(full));
      continue;
    }
    if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("the remove control", () => {
  it("is a real button, not a span pretending to be one", () => {
    render(<CloseButton label="Unregister Alpha" title="Remove Alpha" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Unregister Alpha" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("says what it removes, since the glyph alone names nothing", () => {
    render(<CloseButton label="delete-tag-clutch" title="Delete this tag" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "delete-tag-clutch" })).toBeTruthy();
    expect(screen.getByTitle("Delete this tag")).toBeTruthy();
  });

  it("removes when clicked", () => {
    const onClick = vi.fn();
    render(<CloseButton label="x" title="t" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "x" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not also trigger the row it sits in", () => {
    // A registered player chip toggles selection when clicked. Removing the
    // account must not select it on the way out.
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <ChipPair>
          <button type="button" className="chip">Alpha</button>
          <CloseButton label="Unregister Alpha" title="t" onClick={() => {}} />
        </ChipPair>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unregister Alpha" }));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("carries its inventory code when it is given one", () => {
    render(<CloseButton label="x" title="t" dataAction="I2" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "x" }).getAttribute("data-action")).toBe("I2");
  });

  it("never nests one button inside another", () => {
    const { container } = render(
      <ChipPair>
        <button type="button" className="chip">Alpha</button>
        <CloseButton label="Unregister Alpha" title="t" onClick={() => {}} />
      </ChipPair>,
    );
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });
});

describe("nothing draws its own", () => {
  it("writes the remove glyph in exactly one place", () => {
    // Comments are stripped first, and tests are left out: several files
    // legitimately NAME the cross in prose ("the x on a registered chip
    // removes it"). What must not exist twice is a glyph the interface
    // DRAWS -- a comment cannot drift out of step with the component.
    const withoutComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const offenders = tsxFiles(RENDERER_SRC)
      .filter((file) => path.basename(file) !== "CloseButton.tsx")
      .filter((file) => !file.includes("__tests__"))
      .filter((file) => withoutComments(readFileSync(file, "utf8")).includes(CLOSE_GLYPH))
      .map((file) => path.relative(RENDERER_SRC, file));
    expect(offenders).toEqual([]);
  });

  it("is looking at a real set of files", () => {
    // A walker that finds nothing turns the check above into a test that
    // always passes.
    expect(tsxFiles(RENDERER_SRC).length).toBeGreaterThan(20);
  });

  it("keeps the check/uncheck marks out of it", () => {
    // The demo picker's ✓/✕ are the two halves of one state, not a remove
    // control -- see the note on `MARK` in DemoPicker.tsx. They must not be
    // the remove glyph, or unchecking a row would read as deleting the demo.
    const picker = readFileSync(path.join(RENDERER_SRC, "components", "DemoPicker.tsx"), "utf8");
    expect(picker).not.toContain(CLOSE_GLYPH);
    expect(picker).toContain("const MARK =");
  });
});
