import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { LanguageProvider } from "./i18n";
import "./styles/app.css";

const bootStart = performance.now();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LanguageProvider>
  </React.StrictMode>
);

if (import.meta.env.VITE_STARTUP_PROFILING === "1") {
  requestAnimationFrame(() => {
    const bootMs = performance.now() - bootStart;
    console.info(`[startup] ui_boot_ms=${bootMs.toFixed(1)}`);
  });
}
