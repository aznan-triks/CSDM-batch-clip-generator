/** The four tabs are data, so nothing can quietly grow a fifth. */
import { describe, expect, it } from "vitest";

import { TABS } from "../tabs";

describe("TABS", () => {
  it("names the four tabs of the application, in screen order", () => {
    expect(TABS.map((tab) => tab.id)).toEqual(["capture", "tags", "video", "settings"]);
  });

  it("labels them the way the window does", () => {
    expect(TABS.map((tab) => tab.label)).toEqual(["CAPTURE", "TAGS", "VIDEO", "SETTINGS"]);
  });

  it("gives every tab a distinct id", () => {
    expect(new Set(TABS.map((tab) => tab.id)).size).toBe(TABS.length);
  });
});
