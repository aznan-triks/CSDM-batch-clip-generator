/**
 * The default window geometry, mirrored for code that cannot read Python's
 * DEFAULT_CONFIG synchronously (SettingsTab's reset button, e2e framing).
 *
 * Verified against Python by settings/__tests__/window-defaults.test.ts --
 * do not edit one side alone.
 */
export const WINDOW_DEFAULTS = { w: 1100, h: 900, splitPct: 60 } as const;
