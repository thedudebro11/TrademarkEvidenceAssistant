import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/glass.css";
import "./styles/motion.css";
import "./components/ui/components.css";
import "./components/layout/layout.css";
import "./styles/review.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
