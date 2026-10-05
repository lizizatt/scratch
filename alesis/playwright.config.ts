import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.PORT ?? 8787);
const baseURL = `http://127.0.0.1:${port}`;
const inheritedSampleLibrary = process.env.ALESIS_E2E_SAMPLE_LIBRARY_DIR;
const sampleLibraryDirectory = inheritedSampleLibrary ?? mkdtempSync(join(tmpdir(), "alesis-playwright-samples-"));
const ownershipMarker = join(sampleLibraryDirectory, ".alesis-playwright-owned");
if (!inheritedSampleLibrary) {
  writeFileSync(ownershipMarker, "playwright-owned\n", { flag: "wx" });
  execFileSync(process.execPath, [join(process.cwd(), "scripts/generate-sample-fixtures.mjs"), sampleLibraryDirectory], { stdio: "ignore" });
} else if (!existsSync(ownershipMarker)) {
  throw new Error("Inherited Playwright sample directory is not an owned test fixture");
}
process.env.ALESIS_E2E_SAMPLE_LIBRARY_DIR = sampleLibraryDirectory;
process.env.SAMPLE_LIBRARY_DIR = sampleLibraryDirectory;
process.env.ALESIS_SETTINGS_PATH = join(sampleLibraryDirectory, "playwright-settings-v1.json");

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL, trace: "retain-on-failure" },
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: {
    command: "MIDI_MODE=software AUDIO_MODE=simulated SOFTWARE_VORTEX_DEMO=1 npm run start --workspace @alesis/server",
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    env: {
      SAMPLE_LIBRARY_DIR: sampleLibraryDirectory,
      ALESIS_SETTINGS_PATH: process.env.ALESIS_SETTINGS_PATH,
    },
  },
  projects: [
    // Pi HDMI panel: 480x800, Wayland transform 90, scale 1.
    { name: "alesis-kiosk", use: { ...devices["Desktop Chrome"], viewport: { width: 800, height: 480 }, screen: { width: 800, height: 480 }, deviceScaleFactor: 1, hasTouch: true } },
    { name: "landscape-phone", use: { ...devices["Desktop Chrome"], viewport: { width: 844, height: 390 } } },
    { name: "landscape-tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
