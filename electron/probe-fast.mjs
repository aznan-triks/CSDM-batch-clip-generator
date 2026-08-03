import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => {
  window.bridge = { send(){}, onMessage(){return()=>{}}, pickPath:()=>Promise.resolve(null), pickSavePath:()=>Promise.resolve(null), restartEngine:()=>Promise.resolve() };
});
await page.goto("http://localhost:5273/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".tabs", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 400));

async function read(label) {
  return page.evaluate((l) => {
    const bar = document.querySelector(".tabs");
    const ind = bar?.querySelector(".ind");
    const top = bar?.querySelector(".top-ind");
    const active = bar?.querySelector(".tab.active");
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return Math.round(b.x); };
    return { label: l, active: active?.textContent.trim(), indX: r(ind), topX: r(top), synced: r(ind) === r(top) };
  }, label);
}
console.log("INIT:", JSON.stringify(await read("init")));
await page.click('[role="tab"]:has-text("TAGS")');
await new Promise((r) => setTimeout(r, 600));
console.log("TAGS:", JSON.stringify(await read("tags")));
await page.click('[role="tab"]:has-text("VIDEO")');
await new Promise((r) => setTimeout(r, 600));
console.log("VIDEO:", JSON.stringify(await read("video")));
await page.click('[role="tab"]:has-text("SETTINGS")');
await new Promise((r) => setTimeout(r, 600));
console.log("SETTINGS:", JSON.stringify(await read("settings")));
// FAST consecutive switches (no settle) — the reported one-tab-behind case
await page.click('[role="tab"]:has-text("TAGS")');
await page.click('[role="tab"]:has-text("VIDEO")');
await page.click('[role="tab"]:has-text("SETTINGS")');
await new Promise((r) => setTimeout(r, 800));
console.log("FAST→SETTINGS:", JSON.stringify(await read("fast-settings")));
await browser.close();
