import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./components/splat/StudioApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
);
