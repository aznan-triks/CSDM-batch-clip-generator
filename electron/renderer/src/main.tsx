import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { installSmoothScroll } from "./motion/scroll";
import { applyAccent, DEFAULT_ACCENT } from "./theme/accent";
import "./theme/tokens.css";

// The accent's three derived siblings are computed, never written by hand, so
// they have to be applied once before the first paint -- tokens.css ships the
// default gold so the window is never unstyled, and this recomputes it from
// the same rule the settings screen will use.
applyAccent(DEFAULT_ACCENT);

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
