import { defineConfig } from "vitest/config";

export default defineConfig({
  appType: "spa",
  test: {
    globals: true,
    environment: "node",
  },
});
