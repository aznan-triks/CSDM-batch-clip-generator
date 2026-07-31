import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { installSmoothScroll } from "./motion/scroll";
import { applyAccent, DEFAULT_ACCENT } from "./theme/accent";
import { applyMode, DEFAULT_GROUND } from "./theme/mode";
import "./theme/tokens.css";
// LAST ON PURPOSE. `App` pulls in every component stylesheet above; this one
// is the approved mock ported whole, and on equal specificity the later rule
// wins. Moving this import earlier silently hands the window back to forty
// stylesheets that each drifted a little from the design.
import "./theme/mock.css";

// The accent's three derived siblings are computed, never written by hand, so
// they have to be applied once before the first paint -- tokens.css ships the
// default accent so the window is never unstyled, and this recomputes it from
// the same rule the settings screen will use.
applyAccent(DEFAULT_ACCENT);

// Same reason, for the ground: the stored `theme_bg` arrives later (the store
// reads asynchronously), so the default goes on now and the settings screen
// re-applies the real one once it has read.
applyMode(DEFAULT_GROUND);

// Smoothed scrolling, short inertia, and it switches itself off under
// intensity `none` or `prefers-reduced-motion`.
installSmoothScroll();

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
