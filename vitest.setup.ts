import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

/**
 * O jsdom não implementa reprodução de mídia: chamar `play()` num `<video>`
 * lança "not implemented" e o erro sobe como falha do teste, sem nada a ver
 * com o que se está provando. Aqui ele vira uma promessa resolvida — o que
 * interessa é que o elemento existe, aponta para a URL certa e não dispara
 * progresso, não que o jsdom decodifique H.264.
 */
Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(window.HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});
