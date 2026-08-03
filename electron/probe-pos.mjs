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
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) }; };
    const cs = (el) => el ? { transform: getComputedStyle(el).transform, origin: getComputedStyle(el).transformOrigin, position: getComputedStyle(el).position, left: getComputedStyle(el).left } : null;
    return { label: l, active: active?.textContent.trim(), ind: r(ind), top: r(top), indStyle: cs(ind), topStyle: cs(top) };
  }, label);
}
console.log("INIT:", JSON.stringify(await read("init"), null, 2));
await page.click('[role="tab"]:has-text("TAGS")');
await new Promise((r) => setTimeout(r, 700));
console.log("TAGS:", JSON.stringify(await read("tags"), null, 2));
await page.click('[role="tab"]:has-text("SETTINGS")');
await new Promise((r) => setTimeout(r, 700));
console.log("SETTINGS:", JSON.stringify(await read("settings"), null, 2));
await browser.close();
