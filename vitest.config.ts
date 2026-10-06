import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "web/src/**/*.test.ts"],
    testTimeout: 20000,
    pool: "forks",
  },
});
