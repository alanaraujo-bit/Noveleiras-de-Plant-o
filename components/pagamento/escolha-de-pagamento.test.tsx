/**
 * A tela que decide a conversão, provada no navegador falso.
 *
 * O que esses testes seguram não é layout — é promessa. A pergunta tem de ser
 * respondível em segundos, cada opção tem de dizer **o que acontece no mês
 * seguinte**, e nenhuma palavra de sistema financeiro pode chegar a quem veio
 * assistir novela. Essas três coisas são fáceis de perder numa mudança de
 * texto que parece inofensiva, e nenhum `tsc` reclamaria.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ComoPrefereModo } from "./ComoPrefereModo";
import { FaixaDeRenovacao } from "./FaixaDeRenovacao";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/sistema/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));
vi.mock("@/components/sistema/TelemetryProvider", () => ({
  useTelemetry: () => ({ track: vi.fn() }),
}));

/** Vocabulário que não pode aparecer para quem só quer assistir. */
const TECNIQUES =
  /preapproval|entitlement|recorrente|billing|cobrança recorrente|ciclo|débito automático/i;

describe("como você prefere pagar", () => {
  const base = {
    aberta: true,
    aoFechar: vi.fn(),
    precoCents: 999,
    processando: null,
    aoEscolher: vi.fn(),
  };

  it("faz uma pergunta e oferece duas respostas, com o mesmo preço", () => {
    render(<ComoPrefereModo {...base} />);

    expect(screen.getByText("Como você prefere pagar?")).toBeInTheDocument();
    expect(screen.getByText("Cartão")).toBeInTheDocument();
    expect(screen.getByText("Pix")).toBeInTheDocument();
    expect(screen.getByText("R$ 9,99 por mês")).toBeInTheDocument();
    expect(screen.getByText("R$ 9,99")).toBeInTheDocument();
  });

  it("diz de cada lado só o que muda: o mês seguinte", () => {
    render(<ComoPrefereModo {...base} />);

    expect(
      screen.getByText("Renova automaticamente todos os meses."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Você ganha 1 mês e renova quando quiser."),
    ).toBeInTheDocument();
  });

  it("não usa vocabulário de sistema financeiro", () => {
    const { container } = render(<ComoPrefereModo {...base} />);
    expect(container.textContent ?? "").not.toMatch(TECNIQUES);
  });

  it("devolve a escolha em um toque", () => {
    const aoEscolher = vi.fn();
    render(<ComoPrefereModo {...base} aoEscolher={aoEscolher} />);

    fireEvent.click(screen.getByRole("button", { name: /^Pix/ }));
    expect(aoEscolher).toHaveBeenCalledWith("PIX");
  });

  it("enquanto uma cobrança abre, nenhuma das duas aceita outro toque", () => {
    // Dois toques em opções diferentes abririam duas cobranças.
    const aoEscolher = vi.fn();
    render(
      <ComoPrefereModo {...base} processando="PIX" aoEscolher={aoEscolher} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Cartão/ }));
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(screen.getByText("Preparando…")).toBeInTheDocument();
  });

  it("fechada, não pinta nada", () => {
    const { container } = render(<ComoPrefereModo {...base} aberta={false} />);
    expect(container.textContent).toBe("");
  });
});

describe("aviso de renovação", () => {
  const base = {
    titulo: "Seu Plantão venceu",
    detalhe: "Você ainda pode renovar até 16 de outubro sem perder o acesso.",
    acao: "Renovar com Pix",
  };

  it("não ocupa tela de quem não tem nada a fazer", () => {
    const { container } = render(
      <FaixaDeRenovacao {...base} momento="em-dia" />,
    );
    expect(container.textContent).toBe("");
  });

  it("na tela de assinatura aparece mesmo sem urgência", () => {
    // Quem entrou ali veio administrar o plano: esconder o botão de renovar
    // seria esconder a razão da visita.
    render(<FaixaDeRenovacao {...base} momento="em-dia" mostrarEmDia />);
    expect(
      screen.getByRole("button", { name: "Renovar com Pix" }),
    ).toBeInTheDocument();
  });

  it("depois do vencimento diz o prazo e oferece o caminho", () => {
    render(<FaixaDeRenovacao {...base} momento="carencia" />);

    expect(screen.getByText("Seu Plantão venceu")).toBeInTheDocument();
    expect(screen.getByText(/16 de outubro/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Renovar com Pix" }),
    ).toBeInTheDocument();
  });

  it("o botão abre a cobrança uma vez só", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ attemptId: "t1" }) });
    vi.stubGlobal("fetch", fetchFalso);

    render(<FaixaDeRenovacao {...base} momento="carencia" />);
    const botao = screen.getByRole("button", { name: "Renovar com Pix" });

    fireEvent.click(botao);
    fireEvent.click(botao);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchFalso.mock.calls[0]![1].body)).toEqual({
      tipo: "assinatura",
      plano: "MONTHLY",
      metodo: "PIX",
    });
    vi.unstubAllGlobals();
  });
});
