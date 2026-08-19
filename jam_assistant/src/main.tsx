import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { runMp3Benchmark } from "./spike-browser";
import "./styles.css";

declare global {
  interface Window {
    runMp3Benchmark: typeof runMp3Benchmark;
  }
}

window.runMp3Benchmark = runMp3Benchmark;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
