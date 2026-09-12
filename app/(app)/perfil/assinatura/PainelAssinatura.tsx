"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FaixaDeRenovacao, type Momento } from "@/components/pagamento/FaixaDeRenovacao";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { useToast } from "@/components/sistema/ToastProvider";
import { IconeCheck } from "@/components/ui/icones";
import { Botao, BotaoLink, Divisoria } from "@/components/ui/primitivos";
import { formatDate } from "@/lib/format";

/**
 * Gestão da assinatura e histórico de compras.
 *
 * A Fase 01 tinha aqui um botão que trocava o plano direto no banco, sem
 * cobrança — honesto enquanto não havia o que cobrar, e um buraco no dia em
 * que o paywall passou a valer. Agora **nenhum botão desta tela concede
 * acesso**: assinar leva ao checkout, cancelar chama a rota que fala com o
 * provedor. O estado mostrado vem sempre do servidor.
 */

type Compra = {
  id: string;
  data: string;
  valorCents: number;
  status: string;
  novela: { slug: string; titulo: string };
};

type Pagamento = {
  id: string;
  data: string;
  valorCents: number;
  status: string;
  metodo: string | null;
  plano: string | null;
  renovacao: "AUTO_RENEW" | "MANUAL_RENEW" | null;
  reembolsadoCents: number;
};

type Aviso = {
  momento: Momento;
  titulo: string;
  detalhe: string;
  acao: string;
};

/**
 * Como a cobrança aparece no extrato.
 *
 * `method` do provedor (`credit_card`, `pix`, `account_money`) é vocabulário
 * de integração e não deve chegar a ninguém. Aqui fica o que a pessoa
 * reconhece na própria fatura.
 */
function comoFoiPago(p: Pagamento): string {
  if (p.renovacao === "MANUAL_RENEW") return "Pix";
  if (p.metodo === "pix") return "Pix";
  if (p.renovacao === "AUTO_RENEW") return "Cartão";
  if (p.metodo?.includes("card")) return "Cartão";
  return p.metodo ?? "";
}

const ROTULO_STATUS: Record<string, string> = {
  APPROVED: "Pago",
  PENDING: "Pendente",
  FAILED: "Recusado",
  REFUNDED: "Reembolsado",
  CHARGEBACK: "Estornado",
  PAID: "Pago",
  CANCELED: "Cancelado",
};

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function PainelAssinatura({
  planoNome,
  premium,
  episodiosGratis,
  renovaEm,
  canceladaNoFim,
  status,
  manual,
  renovarAte,
  aviso,
  compras,
  pagamentos,
}: {
  planoNome: string;
  premium: boolean;
  episodiosGratis: number;
  renovaEm: string | null;
  canceladaNoFim: boolean;
  status: string;
  /** Renovação à mão: o plano vale até a data e só continua se ela pagar. */
  manual: boolean;
  renovarAte: string | null;
  aviso: Aviso | null;
  compras: Compra[];
  pagamentos: Pagamento[];
}) {
  const router = useRouter();
  const { show } = useToast();
  const { track } = useTelemetry();
  const [cancelando, setCancelando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  // Pix que venceu e passou da carência: o plano no banco já voltou a FREE,
  // mas para ela o que aconteceu tem nome — "seu Plantão terminou" — e o
  // cartão da tela precisa dizer isso em vez de fingir que nunca houve plano.
  const encerrado = manual && aviso?.momento === "encerrado";
  const emDia = manual && (!aviso || aviso.momento === "em-dia");

  async function cancelar() {
    // Dois cliques rápidos viravam duas chamadas ao Mercado Pago — foi
    // observado em produção, com dois `x-request-id` distintos a 32 segundos
    // um do outro. O `disabled` do botão não basta: o clique do meio do
    // caminho já entrou na fila antes do React repintar.
    //
    // Trava só de interface. A regra de negócio não muda: o servidor continua
    // aceitando quantos pedidos vierem, e o cancelamento segue idempotente —
    // uma assinatura já cancelada no provedor é reconhecida pela reconsulta.
    if (cancelando) return;
    setCancelando(true);
    try {
      const resposta = await fetch("/api/pagamentos/assinatura", {
        method: "DELETE",
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        show(dados.erro ?? "Não foi possível cancelar.", "ruim");
        return;
      }

      track("SUBSCRIPTION_CANCEL");
      show(
        dados.ativoAte
          ? `Cancelado. Você assiste até ${formatDate(dados.ativoAte)}.`
          : "Assinatura cancelada.",
        "neutro",
      );
      router.refresh();
    } catch {
      show("Sem conexão com o servidor.", "ruim");
    } finally {
      setCancelando(false);
      setConfirmando(false);
    }
  }

  return (
    <div className="px-5 pb-10">
      {/* ---------------------------------------------------- estado atual */}
      <section
        className="rounded-3xl border p-5"
        style={{
          borderColor: premium
            ? "rgb(233 189 120 / 0.28)"
            : "rgb(255 255 255 / 0.1)",
          background: premium
            ? "linear-gradient(160deg, rgb(233 189 120 / 0.1), transparent 65%)"
            : "rgb(255 255 255 / 0.03)",
        }}
      >
        <p className="eyebrow">{premium ? "Seu plano" : "Plano atual"}</p>
        {/* Quem assinava por Pix continua vendo o nome do plano que teve, e
            não "Gratuito": o contexto é o que dá sentido à faixa logo abaixo. */}
        <h2 className="mt-0.5 text-[1.375rem] leading-tight">
          {manual ? "Plantão Mensal" : planoNome}
        </h2>

        {/* Terminado, a faixa abaixo já diz tudo: acabou, e o que continua
            dela. Repetir aqui seria a mesma frase duas vezes. */}
        {encerrado ? null : manual && renovaEm ? (
          // Renovação à mão cabe em três linhas curtas, e não na grade de duas
          // colunas do cartão: aqui não há "próximo vencimento" — há uma data
          // até quando vale e a certeza de que nada será cobrado sozinho.
          <div className="mt-2.5">
            <p className="text-[0.9375rem] font-semibold text-cream-50">
              Ativo até {formatDate(renovaEm)}
            </p>
            <p className="mt-1 text-[0.8125rem] text-cream-400">
              Renovação: Pix
            </p>
            <p className="mt-0.5 text-[0.75rem] text-cream-600">
              Você renova quando quiser.
            </p>
          </div>
        ) : premium && renovaEm ? (
          // Duas linhas rotuladas, e não um parágrafo: "como renova" e "até
          // quando" são as duas perguntas que trazem alguém a esta tela, e ler
          // um texto corrido para achá-las é trabalho desnecessário.
          <dl className="mt-3.5 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[0.6875rem] uppercase tracking-wider text-cream-600">
                Forma de renovação
              </dt>
              <dd className="mt-0.5 text-[0.875rem] font-semibold text-cream-50">
                {manual ? "Pix" : "Cartão"}
                <span className="ml-1 block text-[0.75rem] font-normal text-cream-400">
                  {manual
                    ? "você renova quando quiser"
                    : canceladaNoFim
                      ? "renovação cancelada"
                      : "renovação automática"}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[0.6875rem] uppercase tracking-wider text-cream-600">
                {manual || canceladaNoFim ? "Vale até" : "Próximo vencimento"}
              </dt>
              <dd className="mt-0.5 text-[0.875rem] font-semibold text-cream-50">
                {formatDate(renovaEm)}
                {manual && renovarAte ? (
                  <span className="ml-1 block text-[0.75rem] font-normal text-cream-400">
                    dá para renovar até {formatDate(renovarAte)}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        ) : premium ? (
          <p className="mt-2 text-[0.875rem] text-cream-400">
            Catálogo inteiro liberado.
          </p>
        ) : (
          <p className="mt-2 text-[0.875rem] text-cream-400">
            Você vê os {episodiosGratis} primeiros episódios de cada novela.
            {status === "EXPIRED"
              ? " Sua assinatura anterior venceu."
              : ""}
          </p>
        )}

        {manual ? (
          // Nada a cancelar: o plano acaba sozinho se ela não renovar. O que
          // cabe aqui é o caminho de continuar — e ele é o mesmo botão do
          // aviso, para não haver duas maneiras de fazer a mesma coisa.
          <div className="mt-5">
            <FaixaDeRenovacao
              compacta
              mostrarEmDia
              // Em dia, as linhas acima já disseram "Ativo até" e "Você renova
              // quando quiser": sobra só o botão.
              apenasAcao={emDia}
              momento={aviso?.momento ?? "em-dia"}
              titulo={aviso?.titulo ?? "Renove quando quiser"}
              detalhe={
                aviso?.detalhe ??
                "O tempo que ainda falta não se perde: o mês novo entra no fim do atual."
              }
              acao={aviso?.acao ?? "Renovar com Pix"}
            />
          </div>
        ) : premium && !canceladaNoFim ? (
          confirmando ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[0.875rem] text-cream-200">
                Cancelar a renovação? Você continua assistindo até{" "}
                {formatDate(renovaEm ?? "")}, e nada é cobrado depois disso.
              </p>
              <p className="mt-1.5 text-[0.75rem] text-cream-600">
                Novelas que você comprou avulso continuam suas de qualquer jeito.
              </p>
              <div className="mt-4 flex gap-2">
                <Botao
                  variante="secundario"
                  tamanho="pequeno"
                  className="flex-1"
                  onClick={() => setConfirmando(false)}
                >
                  Manter
                </Botao>
                <Botao
                  tamanho="pequeno"
                  className="flex-1"
                  disabled={cancelando}
                  onClick={cancelar}
                >
                  {cancelando ? "Cancelando…" : "Cancelar assinatura"}
                </Botao>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="tap mt-5 text-[0.8125rem] text-cream-600 underline underline-offset-4"
            >
              Cancelar renovação
            </button>
          )
        ) : (
          <BotaoLink
            href="/planos"
            tamanho="grande"
            largura="cheia"
            variante={premium ? "secundario" : "principal"}
            className="mt-5"
          >
            {premium ? "Ver planos" : "Assinar o Plantão"}
          </BotaoLink>
        )}
      </section>

      {/* ------------------------------------------------ novelas compradas */}
      {compras.length > 0 ? (
        <section className="mt-8">
          <p className="eyebrow">Suas para sempre</p>
          <h3 className="mt-0.5 text-[1.125rem] leading-tight">
            Novelas compradas
          </h3>
          <p className="mt-1 text-[0.8125rem] text-cream-600">
            Não dependem de assinatura. Continuam liberadas mesmo se você
            cancelar, incluindo episódios novos.
          </p>

          <ul className="mt-3 space-y-2">
            {compras.map((compra) => {
              const perdida =
                compra.status === "REFUNDED" || compra.status === "CHARGEBACK";
              return (
                <li key={compra.id}>
                  <Link
                    href={`/novela/${compra.novela.slug}`}
                    className="tap flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-3.5"
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-full ${
                        perdida
                          ? "bg-white/6 text-cream-600"
                          : "bg-jade-400/15 text-jade-400"
                      }`}
                    >
                      <IconeCheck tamanho={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.875rem] font-semibold text-cream-50">
                        {compra.novela.titulo}
                      </span>
                      <span className="block text-[0.75rem] text-cream-600">
                        {formatDate(compra.data)} · {reais(compra.valorCents)}
                        {perdida
                          ? ` · ${ROTULO_STATUS[compra.status] ?? compra.status}`
                          : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* --------------------------------------------------------- extrato */}
      <section className="mt-8">
        <p className="eyebrow">Transparência</p>
        <h3 className="mt-0.5 text-[1.125rem] leading-tight">
          Histórico de cobranças
        </h3>

        {pagamentos.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-[0.8125rem] text-cream-600">
            Nenhuma cobrança até agora. Quando houver, cada uma aparece aqui com
            data, valor e situação.
          </p>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-2xl border border-white/8">
            {pagamentos.map((pagamento, indice) => (
              <li key={pagamento.id}>
                {indice > 0 ? <Divisoria /> : null}
                <div className="flex items-center justify-between gap-3 bg-white/[0.02] px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[0.875rem] text-cream-50">
                      {reais(pagamento.valorCents)}
                      {pagamento.reembolsadoCents > 0 ? (
                        <span className="ml-1.5 text-[0.75rem] text-cream-600">
                          (−{reais(pagamento.reembolsadoCents)})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[0.75rem] text-cream-600">
                      {formatDate(pagamento.data)}
                      {comoFoiPago(pagamento) ? ` · ${comoFoiPago(pagamento)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${
                      pagamento.status === "APPROVED"
                        ? "bg-jade-400/15 text-jade-400"
                        : "bg-white/8 text-cream-400"
                    }`}
                  >
                    {ROTULO_STATUS[pagamento.status] ?? pagamento.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-center text-[0.75rem] leading-relaxed text-cream-600">
        Perdeu o acesso depois de trocar de aparelho? É só entrar na sua conta —
        assinatura e compras ficam ligadas ao seu login, não ao dispositivo.
      </p>
    </div>
  );
}
