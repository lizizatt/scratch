import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 8787);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "MIDI_MODE=software AUDIO_MODE=simulated SOFTWARE_VORTEX_DEMO=1 npm run start --workspace @alesis/server",
    url: `${baseURL}/health`,
    reuseExistingServer: true,
  },
  projects: [
    { name: "landscape-phone", use: { ...devices["Desktop Chrome"], viewport: { width: 844, height: 390 } } },
    { name: "landscape-tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
