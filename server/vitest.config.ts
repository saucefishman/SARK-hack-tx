import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    // Pin the demo clock: the seed's future plans must stay in the future whenever the tests run.
    env: { AS_OF_DATE: "2026-10-25" },
  },
});
