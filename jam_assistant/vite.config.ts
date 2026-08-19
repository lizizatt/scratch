import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
  },
  test: {
    globals: true,
    coverage: {
      enabled: false,
    },
    include: ["tests/**/*.test.ts"],
  },
});
