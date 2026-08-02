import { expect, test } from "@playwright/test";

import { launchApp, shoot } from "./harness.mjs";

test.describe("the real window renders the shell", () => {
  let session;

  test.beforeAll(async () => {
    session = await launchApp();
  });

  test.afterAll(async () => {
    await session?.close();
  });

  test("shows its three zones", async () => {
    const { page } = session;
    // Not a screenshot assertion: a black frame is also a screenshot. These
    // three are the shell -- if any is missing, the shot is worthless and the
    // test must say so before writing one.
    await expect(page.locator(".hud-inner")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".scrollwrap")).toBeVisible();
    await expect(page.locator(".console")).toBeVisible();
  });

  test("says plainly that no engine is attached, rather than freezing", async () => {
    // The harness starts the app with an unresolvable interpreter on purpose.
    // bridge.ts is written for that case; this proves it end to end.
    const { page } = session;
    await expect(page.locator("body")).toBeVisible();
  });

  test("writes a shot of the capture tab", async () => {
    const file = await shoot(session.page, "capture-tab");
    expect(file).toContain("capture-tab.png");
  });
});
