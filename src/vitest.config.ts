import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      include: ["app/**/*.ts"],
      exclude: ["app/server.ts", "app/services/kubernetesObservability.ts", "tests/**", "dist/**", "**/*.d.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        // Vitest 4 (AST-aware v8 remapping) counts ~8% more branches than 2.x for the
        // same tests (91 -> 85.6%). Lowered from 88 until route branch tests are added.
        branches: 85,
      },
    },
  },
});