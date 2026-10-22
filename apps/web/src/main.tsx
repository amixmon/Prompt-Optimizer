import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/space-grotesk/latin-600.css";
import App from "./App";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
