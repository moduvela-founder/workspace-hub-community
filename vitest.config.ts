import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/hub-*.test.ts"], environment: "node" } });
