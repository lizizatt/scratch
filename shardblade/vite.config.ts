import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sceneSavePlugin } from "./vite.sceneSave";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  appType: "spa",
  plugins: [sceneSavePlugin(path.join(root, "scenes"))],
  test: {
    globals: true,
    environment: "node",
  },
});
