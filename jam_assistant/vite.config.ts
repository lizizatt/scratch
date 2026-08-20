import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
  },
  server: {
    allowedHosts: ["alexandria.taildc7398.ts.net"],
    watch: {
      ignored: ["**/artifacts/**", "**/test-results/**"],
    },
  },
  test: {
    globals: true,
    coverage: {
      enabled: false,
    },
    include: ["tests/**/*.test.ts"],
  },
});
