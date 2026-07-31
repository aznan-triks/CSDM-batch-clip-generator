/**
 * The list of CSS properties that move an element, or resize it so its
 * content moves. `padding` is here on purpose: growing the padding on hover
 * shifts a label just as visibly as translating it.
 *
 * SHARED on purpose between two consumers that must never disagree on what
 * counts as motion:
 *  - renderer/src/__tests__/no-hover-motion.test.ts, which fails the build if
 *    ANY shipped stylesheet declares one of these inside a `:hover` rule.
 *  - postcss-strip-mock-hover-motion.mjs, which removes these from the
 *    approved mock's own `:hover` rules at build time (and ONLY the mock's --
 *    see that file for why).
 * Two separate copies of "what counts as motion" could drift apart: the
 * strip would stop removing something the guard still flags, or start
 * removing something the guard was never checking for. One list, read by
 * both.
 */
export const MOTION_PROPERTIES = [
  "transform",
  "translate",
  "rotate",
  "scale",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
];

/** True for `property` itself or any of its longhands (`margin` matches `margin-top`). */
export function isMotionProperty(property) {
  const name = property.toLowerCase().trim();
  return MOTION_PROPERTIES.some((motion) => name === motion || name.startsWith(`${motion}-`));
}
