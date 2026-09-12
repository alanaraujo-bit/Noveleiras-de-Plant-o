/**
 * A tela do Pix, estado por estado.
 *
 * O que estes testes seguram é a ordem das coisas, porque é ela que decide se
 * a pessoa consegue pagar pelo celular:
 *
 * - **copiar** é a ação principal; o QR, que ninguém escaneia no próprio
 *   aparelho, fica recolhido no celular e aberto no desktop;
 * - a tela **diz** que a confirmação é automática, e "Já paguei" é reserva;
 * - aprovado fala a data, e renovação fala "agora", para ela ver que não
 *   perdeu os dias que tinha;
 * - Pix expirado é uma frase e um botão, sem cara de erro.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EstadoDoPagamento } from "./EstadoDoPagamento";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/sistema/TelemetryProvider", () => ({
  useTelemetry: () => ({ track: vi.fn() }),
}));

const CODIGO = "00020126580014br.gov.bcb.pix0136abc5204000053039865802BR";

const pixPendente = {
  id: "t1",
  status: "PENDING" as const,
  tipo: "SUBSCRIPTION" as const,
  renovacao: "MANUAL_RENEW" as const,
  valorCents: 999,
  metodo: "pix",
  checkoutUrl: null,
  pixQrCode: CODIGO,
  pixQrCodeBase64: "iVBORw0KGgo=",
  expiraEm: "2026-09-11T15:30:00Z",
  liberadoAte: null,
  ciclo: null,
  mensagem: null,
  motivoCru: "pending",
};

function tela(inicial: Partial<typeof pixPendente> & { status?: string } = {}) {
  return render(
    <EstadoDoPagamento
      inicial={{ ...pixPendente, ...inicial } as never}
      destino="/plantao"
      nomeDoItem="Plantão Mensal"
    />,
  );
}

beforeEach(() => {
  // A tela consulta o servidor sozinha; aqui ele responde "ainda pendente".
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => pixPendente }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Pix gerado", () => {
  it("fala com clareza: título, valor e a promessa de liberar sozinho", () => {
    tela();

    expect(screen.getByRole("heading", { name: "Pix gerado" })).toBeInTheDocument();
    expect(screen.getByText("R$ 9,99")).toBeInTheDocument();
    expect(
      screen.getByText("Assim que você pagar, seu Plantão será liberado automaticamente."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Esperando o Pix/)).toBeNull();
  });

  it("copiar é a primeira ação da tela", () => {
    tela();

    // A ordem no documento é a ordem de leitura e de foco: o botão de copiar
    // vem antes do QR e antes da reserva "Já paguei".
    const botoes = screen.getAllByRole("button").map((b) => b.textContent);
    expect(botoes[0]).toBe("Copiar código Pix");
  });

  it("explica o caminho no banco em três passos curtos", () => {
    tela();

    expect(screen.getByText("Abra o app do seu banco")).toBeInTheDocument();
    expect(screen.getByText("Escolha Pix › Copia e Cola")).toBeInTheDocument();
    expect(screen.getByText("Cole o código e confirme")).toBeInTheDocument();
  });

  it("copiar dá retorno na hora, sem abrir nada por cima", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: escrever },
    });

    tela();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar código Pix" }));
    });

    expect(escrever).toHaveBeenCalledWith(CODIGO);
    expect(screen.getByRole("button", { name: "Código Pix copiado ✓" })).toBeInTheDocument();
    expect(screen.getByText("Agora é só colar no app do seu banco.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("diz que a confirmação é automática, e deixa o 'Já paguei' como reserva", () => {
    tela();

    expect(screen.getByText("Aguardando pagamento")).toBeInTheDocument();
    expect(screen.getByText(/A confirmação é automática/)).toBeInTheDocument();

    const reserva = screen.getByRole("button", { name: "Já paguei — conferir agora" });
    // Reserva e parece uma: texto pequeno sublinhado, não um botão cheio.
    expect(reserva.className).toMatch(/underline/);
    expect(reserva.className).not.toMatch(/bg-/);
  });

  it("no celular o QR fica recolhido e aparece quando pedido", () => {
    tela();

    const qr = screen.getByAltText("QR Code para pagar com Pix");
    const caixa = qr.closest("div.w-full")!;
    // Escondido no celular, aberto a partir do tablet — sem adivinhar a
    // largura da tela em JavaScript.
    expect(caixa.className).toMatch(/\bhidden\b/);
    expect(caixa.className).toMatch(/md:block/);

    fireEvent.click(screen.getByRole("button", { name: "Pagar em outro aparelho" }));
    expect(caixa.className).toMatch(/\bblock\b/);
    expect(caixa.className).not.toMatch(/\bhidden\b/);
  });

  it("mostra até quando o código vale", () => {
    tela();
    expect(screen.getByText(/Este código vale até/)).toBeInTheDocument();
  });
});

describe("pagamento aprovado", () => {
  it("primeira assinatura: diz até quando está liberado e convida a assistir", () => {
    tela({
      status: "APPROVED",
      liberadoAte: "2026-10-11T15:00:00Z",
      ciclo: 1,
    } as never);

    expect(screen.getByRole("heading", { name: "Pagamento aprovado" })).toBeInTheDocument();
    expect(
      screen.getByText("Seu Plantão está liberado até 11 de outubro."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Começar a assistir" })).toHaveAttribute(
      "href",
      "/plantao",
    );
  });

  it("renovação: diz 'agora' e que nada se perdeu", () => {
    tela({
      status: "APPROVED",
      liberadoAte: "2026-11-11T15:00:00Z",
      ciclo: 2,
    } as never);

    expect(screen.getByRole("heading", { name: "Renovação concluída" })).toBeInTheDocument();
    expect(
      screen.getByText("Seu Plantão agora está liberado até 11 de novembro."),
    ).toBeInTheDocument();
    expect(screen.getByText(/nada se perdeu/)).toBeInTheDocument();
  });

  it("a tela vira sozinha quando o pagamento cai", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...pixPendente,
          status: "APPROVED",
          liberadoAte: "2026-10-11T15:00:00Z",
          ciclo: 1,
        }),
      }),
    );

    tela();
    expect(screen.getByRole("heading", { name: "Pix gerado" })).toBeInTheDocument();

    // Ninguém tocou em nada: a consulta automática fez o trabalho.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Pagamento aprovado" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("Pix expirado", () => {
  it("uma frase curta e o botão que resolve", () => {
    tela({ status: "EXPIRED", motivoCru: "expired" } as never);

    expect(screen.getByRole("heading", { name: "Esse Pix expirou" })).toBeInTheDocument();
    expect(screen.getByText(/Gere um novo código para continuar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerar novo Pix" })).toBeInTheDocument();
    // Nada de linguagem de erro.
    expect(document.body.textContent).not.toMatch(/erro|falha|recusad/i);
  });
});
