import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const alias = { "@": resolve(process.cwd()) };

/**
 * Dois ambientes, de propósito.
 *
 * Regra de negócio e formatação não precisam de DOM, e rodar tudo em `jsdom`
 * cobraria o preço do navegador falso a cada teste puro. As telas, por outro
 * lado, precisam existir para serem clicadas: que o botão apareça, que o
 * diálogo abra e que o trailer não crie progresso são coisas que não se
 * provam lendo o código.
 *
 * `scripts/fluxo.mjs` continua valendo — ele prova o app inteiro de pé. Estes
 * testes provam o componente isolado, e são os que rodam em cada commit.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "regras",
          environment: "node",
          include: ["lib/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "telas",
          environment: "jsdom",
          include: ["components/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
