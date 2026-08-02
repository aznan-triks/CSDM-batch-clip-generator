import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { BASELINE_DIR, CONFIG, SHOT_DIR } from "./config.mjs";

/**
 * Compare a fresh shot to its stored baseline.
 *
 * Returns { status: "created" | "match" | "drift", ratio, diffFile }.
 *
 * A missing baseline is CREATED, not failed: the first run of a new screen
 * should record what it looks like, and the reviewer decides whether that
 * image is right by looking at it in the commit.
 */
export function compareToBaseline(name) {
  mkdirSync(BASELINE_DIR, { recursive: true });
  const shotFile = path.join(SHOT_DIR, `${name}.png`);
  const baseFile = path.join(BASELINE_DIR, `${name}.png`);

  if (!existsSync(baseFile)) {
    writeFileSync(baseFile, readFileSync(shotFile));
    return { status: "created", ratio: 0, diffFile: null };
  }

  const shot = PNG.sync.read(readFileSync(shotFile));
  const base = PNG.sync.read(readFileSync(baseFile));

  if (shot.width !== base.width || shot.height !== base.height) {
    // A size change is a real difference, not a comparison error: report it
    // rather than resizing one of them, which would hide what moved.
    return { status: "drift", ratio: 1, diffFile: null };
  }

  const diff = new PNG({ width: shot.width, height: shot.height });
  const changed = pixelmatch(base.data, shot.data, diff.data, shot.width, shot.height, {
    threshold: 0.1, // per-pixel colour tolerance, not the overall gate below
  });
  const ratio = changed / (shot.width * shot.height);

  if (ratio <= CONFIG.diffThreshold) return { status: "match", ratio, diffFile: null };

  const diffFile = path.join(SHOT_DIR, `${name}.diff.png`);
  writeFileSync(diffFile, PNG.sync.write(diff));
  return { status: "drift", ratio, diffFile };
}
