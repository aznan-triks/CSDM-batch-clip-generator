import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { applyAccent, DEFAULT_ACCENT } from "./theme/accent";
import "./theme/tokens.css";
import "./skeleton.css";

// The accent's three derived siblings are computed, never written by hand, so
// they have to be applied once before the first paint -- tokens.css ships the
// default gold so the window is never unstyled, and this recomputes it from
// the same rule the settings screen will use.
applyAccent(DEFAULT_ACCENT);

const container = document.getElementById("root");
if (!container) {
  // Fail fast and loud: a missing root means the page shipped broken.
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
