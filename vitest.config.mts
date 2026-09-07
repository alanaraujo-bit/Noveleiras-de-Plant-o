import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Testes de regra de negócio e de formatação; o fluxo de tela é coberto
    // por scripts/fluxo.mjs contra o app rodando de verdade.
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(process.cwd()) },
  },
});
