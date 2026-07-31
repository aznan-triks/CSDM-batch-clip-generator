/**
 * Strips motion-property declarations out of `:hover` rules -- but ONLY when
 * the stylesheet being processed is the approved mock's own extraction,
 * renderer/src/theme/mock-v12.css.
 *
 * WHY THIS EXISTS: the approved mock
 * (docs/ui-restyle-mockups/mockup-v12-hologlass.html) legitimately bounces
 * four things on hover (.sec, .chip, .btn.primary, .big-sw). This window
 * forbids ANY hover motion outright (D13/D16), enforced by
 * renderer/src/__tests__/no-hover-motion.test.ts. mock-v12.css is a verbatim,
 * generated extraction of the mock's own <style> block -- drift-locked
 * against the source HTML by
 * renderer/src/theme/__tests__/mock-v12.test.ts -- so it can never be
 * hand-edited to remove those four rules. The fix has to happen at build
 * time, between the verbatim source and the shipped bundle.
 *
 * WHY IT IS SCOPED TO EXACTLY ONE FILE, NOT EVERY STYLESHEET: the hover
 * guard this plugin feeds into exists because a real component once moved on
 * hover by accident and nothing caught it (see that test's own header). A
 * plugin that stripped hover motion from every stylesheet would silently fix
 * that same class of regression at build time instead of failing the test --
 * which turns the guard into a silencer: an app component could grow its own
 * `.foo:hover { transform: ... }` and ship clean, undetected. Gating on the
 * source file keeps every OTHER stylesheet fully covered by the guard. The
 * mock is the one exception, and it already has its own, different proof
 * that it is unmodified (the drift-lock test above), plus the fact that it
 * is an approved, read-only design document, not app code anyone can
 * regress by accident.
 *
 * Shares its definition of "motion" with no-hover-motion.test.ts
 * (scripts/motion-properties.mjs) so the strip can never remove more, or
 * less, than what the guard actually checks for.
 */
import { isMotionProperty } from "./scripts/motion-properties.mjs";

const MOCK_STYLESHEET_SUFFIX = "/theme/mock-v12.css";

/** True when `file` is this project's generated mock-v12.css, not a same-named file elsewhere. */
function isMockStylesheet(file) {
  if (!file) return false;
  return file.replace(/\\/g, "/").split("?")[0].endsWith(MOCK_STYLESHEET_SUFFIX);
}

export default function stripMockHoverMotion() {
  return {
    postcssPlugin: "strip-mock-hover-motion",
    Once(root) {
      const file = root.source && root.source.input && root.source.input.file;
      if (!isMockStylesheet(file)) return;

      root.walkRules((rule) => {
        if (!rule.selector.includes(":hover")) return;
        rule.walkDecls((decl) => {
          if (isMotionProperty(decl.prop)) decl.remove();
        });
        // A rule stripped down to nothing (`.big-sw:hover{transform:scale(1.08)}`
        // had only the one, motion, declaration) is dead weight in the shipped
        // CSS -- drop it rather than ship an empty `.foo:hover{}`.
        if (rule.nodes.length === 0) rule.remove();
      });
    },
  };
}
stripMockHoverMotion.postcss = true;
