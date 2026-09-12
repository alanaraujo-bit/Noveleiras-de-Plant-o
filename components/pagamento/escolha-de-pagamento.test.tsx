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

// Içado: os testes precisam ver para onde a tela mandou a pessoa.
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navegacao,
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
    expect(screen.getByText("Cartão de crédito")).toBeInTheDocument();
    expect(screen.getByText("Pix")).toBeInTheDocument();
    expect(screen.getByText("R$ 9,99/mês")).toBeInTheDocument();
    expect(screen.getByText("R$ 9,99 por 1 mês")).toBeInTheDocument();
  });

  it("diz de cada lado só o que muda: o mês seguinte", () => {
    render(<ComoPrefereModo {...base} />);

    expect(
      screen.getByText("Renova automaticamente todos os meses."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Você renova quando quiser."),
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

describe("aviso de renovação: o que o botão faz em cada momento", () => {
  const base = { titulo: "t", detalhe: "d", acao: "Renovar com Pix" };

  it("em dia, na tela de assinatura, é só o botão — sem repetir o que já está escrito", () => {
    render(
      <FaixaDeRenovacao
        titulo="Ativo até 11 de outubro"
        detalhe="Você renova quando quiser."
        acao="Renovar com Pix"
        momento="em-dia"
        mostrarEmDia
        apenasAcao
      />,
    );

    expect(screen.getByRole("button", { name: "Renovar com Pix" })).toBeInTheDocument();
    expect(screen.queryByText("Ativo até 11 de outubro")).toBeNull();
    expect(screen.queryByText("Você renova quando quiser.")).toBeNull();
  });

  it("quem já terminou volta à escolha de pagamento, sem cobrança criada", () => {
    // Ela pode preferir o cartão desta vez. Abrir um Pix sem perguntar
    // decidiria por ela.
    navegacao.push.mockClear();
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    render(
      <FaixaDeRenovacao {...base} momento="encerrado" acao="Voltar ao Plantão" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao Plantão" }));

    expect(fetchFalso).not.toHaveBeenCalled();
    expect(navegacao.push).toHaveBeenCalledWith("/planos");
    vi.unstubAllGlobals();
  });
});

describe("tela de planos", () => {
  const planos = [
    { code: "MONTHLY" as const, nome: "Plantão Mensal", descricao: "", precoCents: 999, intervalo: "MONTH" as const, beneficios: [], cor: "#e03a69" },
    { code: "ANNUAL" as const, nome: "Plantão Anual", descricao: "", precoCents: 9990, intervalo: "YEAR" as const, beneficios: [], cor: "#d9a355" },
  ];
  const semPlano = { premium: false, plano: "FREE", planoNome: "Plantão Gratuito", renovaEm: null, cancelado: false, manual: false };

  it("o mensal promete o próximo passo e pergunta antes de cobrar", async () => {
    const { Planos } = await import("./Planos");
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    render(
      <Planos planos={planos} atual={semPlano} gratuitos={5} economiaCents={1998} mensalEquivalenteCents={833} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Escolher forma de pagamento" }));

    // Nenhuma cobrança nasce no toque: primeiro, a pergunta.
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(screen.getByText("Como você prefere pagar?")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("quem já paga por Pix lê até quando vale, não uma renovação que não vai acontecer", async () => {
    const { Planos } = await import("./Planos");
    render(
      <Planos
        planos={planos}
        atual={{ ...semPlano, premium: true, plano: "MONTHLY", planoNome: "Plantão Mensal", renovaEm: "2026-10-11T15:00:00Z", manual: true }}
        gratuitos={5}
        economiaCents={1998}
        mensalEquivalenteCents={833}
      />,
    );

    expect(screen.getByText(/Vale até/)).toBeInTheDocument();
    expect(screen.queryByText(/Renova em/)).toBeNull();
    expect(screen.getByRole("button", { name: "Renovar o mensal" })).toBeInTheDocument();
  });
});
