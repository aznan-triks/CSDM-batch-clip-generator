import { writeFileSync } from "node:fs";
import path from "node:path";

import { SHOT_DIR } from "./config.mjs";

/**
 * Write one HTML page putting each app shot beside the mock it answers to.
 *
 * This is NOT a comparison the machine can make: the mock shows invented
 * demo data, the app shows real data and user-ordered sections, so a pixel
 * diff between them would be red forever and therefore ignored. What a
 * machine CAN do is put them side by side at the same size so the human
 * judgement required by §1 P8 takes one glance instead of a manual dance.
 */
export function writeContactSheet(pairs) {
  const rows = pairs
    .map(
      ({ app, mock, title }) => `
    <section>
      <h2>${title}</h2>
      <div class="pair">
        <figure><figcaption>App</figcaption><img src="./${app}.png" alt="app: ${title}"></figure>
        <figure><figcaption>Mock</figcaption><img src="./${mock}.png" alt="mock: ${title}"></figure>
      </div>
    </section>`,
    )
    .join("\n");

  const html = `<!doctype html>
<meta charset="utf-8">
<title>App vs approved mock</title>
<style>
  body { margin: 0; padding: 24px; background: #111; color: #eee;
         font: 14px/1.5 system-ui, sans-serif; }
  h2 { font-size: 15px; font-weight: 600; margin: 24px 0 8px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  figure { margin: 0; }
  figcaption { font-size: 12px; opacity: .6; margin-bottom: 6px; }
  img { width: 100%; height: auto; display: block; border: 1px solid #333; }
</style>
<h1>App vs approved mock</h1>
${rows}
`;
  const file = path.join(SHOT_DIR, "contact-sheet.html");
  writeFileSync(file, html, "utf8");
  return file;
}
