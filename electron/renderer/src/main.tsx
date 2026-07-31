// ORDER IS THE DESIGN, AND IT IS THE ORDER OF THESE LINES. The approved mock
// first -- it is the base vocabulary, verbatim and never edited. The bridge
// next: the only file allowed to disagree with it, one measured reason per
// line. The app's own tokens last, so a corrected value wins over the mock's.
// Component stylesheets arrive with `App` below and refine, never restate.
//
// THESE THREE LINES MUST STAY ABOVE `import App`. ES modules are evaluated in
// source order, so an `import App` placed first pulls in every component
// stylesheet BEFORE these -- which put the mock last and let it overrule every
// component rule, the exact opposite of the sentence above. Measured in the
// built bundle: Tab.css at byte 37125, mock-v12.css at 47897.
import "./theme/mock-v12.css";
import "./theme/mock-bridge.css";
import "./theme/tokens.css";
// After tokens.css, and for the same reason tokens.css comes after the mock: a
// night ground refines the dark block rather than replacing it, so it has to be
// able to win on the handful of tokens that make it itself.
import "./theme/grounds.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { applyAccent, DEFAULT_ACCENT } from "./theme/accent";
import { applyMode, DEFAULT_GROUND } from "./theme/mode";

// The accent's three derived siblings are computed, never written by hand, so
// they have to be applied once before the first paint -- tokens.css ships the
// default accent so the window is never unstyled, and this recomputes it from
// the same rule the settings screen will use.
applyAccent(DEFAULT_ACCENT);

// Same reason, for the ground: the stored `theme_bg` arrives later (the store
// reads asynchronously), so the default goes on now and the settings screen
// re-applies the real one once it has read.
applyMode(DEFAULT_GROUND);

// No page-level smooth scrolling here. The shell is a fixed 100vh frame and
// the scrolling happens INSIDE it -- `.scrollwrap` for the tab, the console's
// own body for the log. A library that owns the window's wheel has nothing to
// move in that layout and swallows the notch on its way to the panes, which is
// exactly what it did (src/__tests__/wheel-reaches-the-pane.test.ts).

const container = document.getElementById("root");
if (!container) {
  // Fail fast and loud: a missing root means the page shipped broken.
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
