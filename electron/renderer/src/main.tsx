import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./skeleton.css";

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
