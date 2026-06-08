import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Kit styles, in order: self-hosted fonts first, then design tokens, then the
// thin app-specific layer (closet ledger + donut) that builds on --t10-* tokens.
import "@troop10rwc/ui/fonts.css";
import "@troop10rwc/ui/theme.css";
import "./app.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
