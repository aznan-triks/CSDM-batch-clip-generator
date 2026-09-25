/**
 * First-run audit (2026-09-25): a new user with no database, or an empty
 * one, must be told what to do -- not left on "Waiting for DB…" forever.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DatabasePending, { DB_UNREACHABLE_HINT } from "../../settings/DatabasePending";
import HudNav from "../../shell/HudNav";
import PlayerSection from "../PlayerSection";

const db = vi.hoisted(() => ({ value: { database: null as unknown, error: null as string | null } }));

vi.mock("../../settings/useDatabase", () => ({
  useDatabase: () => ({ ...db.value, reload: () => {} }),
}));

vi.mock("../../settings/store", () => ({
  useSetting: () => [[], () => {}],
  useSettingsBatch: () => () => {},
}));

beforeEach(() => {
  db.value = { database: null, error: null };
});

describe("a database-fed card before it has data", () => {
  it("still says it is waiting while the first answer is pending", () => {
    render(<DatabasePending />);
    expect(screen.getByText("Waiting for DB…")).toBeTruthy();
  });

  it("points at the settings to fix once the connection failed", () => {
    db.value = { database: null, error: "connection refused" };
    render(<DatabasePending />);
    const hint = screen.getByText(DB_UNREACHABLE_HINT);
    expect(hint.textContent).toMatch(/SETTINGS/);
    expect(hint.getAttribute("title")).toBe("connection refused");
  });

  it("is what the Player card shows when the database is unreachable", () => {
    db.value = { database: null, error: "connection refused" };
    render(<PlayerSection />);
    expect(screen.getByText(DB_UNREACHABLE_HINT)).toBeTruthy();
  });
});

describe("an empty database", () => {
  it("says the demos must be analyzed first, not that nothing matches", () => {
    db.value = { database: { weapons: [], maps: [], players: [], tags: [] }, error: null };
    render(<PlayerSection />);
    expect(screen.getByText(/No player in this database yet/)).toBeTruthy();
    expect(screen.queryByText("No player matches.")).toBeNull();
  });
});

describe("the DB pill", () => {
  const nav = (dbState?: "pending" | "ok" | "error") =>
    render(<HudNav tabs={[]} active="" onSelect={() => {}} database="csdm" dbState={dbState} />);

  it("does not claim a connection that failed", () => {
    nav("error");
    const pill = screen.getByText("offline").closest(".p");
    expect(pill?.getAttribute("title")).toMatch(/SETTINGS/);
    expect(screen.queryByText("csdm")).toBeNull();
  });

  it("shows the database name once connected", () => {
    nav("ok");
    expect(screen.getByText("csdm")).toBeTruthy();
  });
});
