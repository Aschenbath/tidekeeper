import { defineConfig } from "vitest/config";

// The game core is plain TypeScript; tests skip the IWSDK Vite plugin.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
