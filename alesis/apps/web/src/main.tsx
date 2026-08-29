import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

let reloadingForUpdate = false;
let hasServiceWorkerController = navigator.serviceWorker.controller !== null;
navigator.serviceWorker.addEventListener("controllerchange", () => {
  if (!hasServiceWorkerController) {
    hasServiceWorkerController = true;
    return;
  }
  if (reloadingForUpdate) return;
  reloadingForUpdate = true;
  location.reload();
});

registerSW({
  immediate: true,
  onRegisteredSW(_workerUrl, registration) {
    if (!registration) return;
    window.setInterval(() => void registration.update(), 60_000);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
