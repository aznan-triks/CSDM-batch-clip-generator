/**
 * Flat glyphs for the VIDEO cards' tiles and drawings, in the repo's icon
 * style (24-unit box, currentColor, a translucent fill under a solid mark).
 */
import type { ReactNode } from "react";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const GLYPHS = {
  clip: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" fill="currentColor" opacity=".25" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" />
    </svg>
  ),
  join: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 6h5l3 6-3 6H4M20 12h-8" />
      <path d="M17 9l3 3-3 3" />
    </svg>
  ),
  film: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" opacity=".25" />
      <path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  screen: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="20" height="13" rx="2" fill="currentColor" opacity=".25" />
      <rect x="2" y="4" width="20" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="3" width="13" height="10" rx="2" fill="currentColor" opacity=".25" />
      <rect x="3" y="10" width="13" height="10" rx="2" fill="currentColor" opacity=".55" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="currentColor" opacity=".25" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </svg>
  ),
  feed: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="4" rx="1.5" fill="currentColor" />
      <rect x="6" y="10" width="15" height="4" rx="1.5" fill="currentColor" opacity=".55" />
      <rect x="9" y="16" width="12" height="4" rx="1.5" fill="currentColor" opacity=".25" />
    </svg>
  ),
  xray: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="11" y="3" width="3" height="18" rx="1" fill="currentColor" opacity=".3" />
      <circle cx="7" cy="7" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 10v6M4 12h6M7 16l-2 4M7 16l2 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18" cy="7" r="2.5" fill="currentColor" />
      <path d="M18 10v6M15 12h6M18 16l-2 4M18 16l2 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" opacity=".25" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  timer: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </svg>
  ),
  fov: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12L21 4v16z" fill="currentColor" opacity=".25" />
      <path d="M3 12L21 4M3 12l18 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="3.5" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  speed: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-6" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l9 5-9 5-9-5z" fill="currentColor" />
      <path d="M3 12l9 5 9-5M3 16l9 5 9-5" fill="none" stroke="currentColor" strokeWidth="1.8" opacity=".6" />
    </svg>
  ),
  hud: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" opacity=".2" />
      <path d="M5 16h4M15 16h4M5 7h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  scope: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </svg>
  ),
  ragdoll: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7" cy="6" r="2.5" fill="currentColor" />
      <path d="M8 9l5 4 6-1M13 13l-2 6M13 13l5 5M9 10l-4 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  weight: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9h12l3 11H3z" fill="currentColor" opacity=".3" />
      <circle cx="12" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12v5M9.5 14.5L12 17l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".25" />
      <path d="M12 3v18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  blood: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" fill="currentColor" opacity=".35" />
      <path d="M12 3c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="10" r="5" fill="currentColor" opacity=".35" />
      <path d="M12 1v2M4 10H2M22 10h-2M5.6 3.6l1.4 1.4M18.4 3.6L17 5M9 18h6M10 21h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  args: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" opacity=".35" />
      <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  quality: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" fill="currentColor" />
      <rect x="13" y="3" width="8" height="8" fill="currentColor" opacity=".35" />
      <rect x="3" y="13" width="8" height="8" fill="currentColor" opacity=".35" />
      <rect x="13" y="13" width="8" height="8" fill="currentColor" />
    </svg>
  ),
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;
