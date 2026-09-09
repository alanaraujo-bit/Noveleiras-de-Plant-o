"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  reembolsadoCents: number;
};

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
  compras,
  pagamentos,
}: {
  planoNome: string;
  premium: boolean;
  episodiosGratis: number;
  renovaEm: string | null;
  canceladaNoFim: boolean;
  status: string;
  compras: Compra[];
  pagamentos: Pagamento[];
}) {
  const router = useRouter();
  const { show } = useToast();
  const { track } = useTelemetry();
  const [cancelando, setCancelando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  async function cancelar() {
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
        <h2 className="mt-0.5 text-[1.375rem] leading-tight">{planoNome}</h2>

        {premium ? (
          <p className="mt-2 text-[0.875rem] text-cream-400">
            {canceladaNoFim
              ? `Cancelada. Você continua assistindo até ${formatDate(renovaEm ?? "")} — o período já foi pago.`
              : renovaEm
                ? `Renova automaticamente em ${formatDate(renovaEm)}.`
                : "Catálogo inteiro liberado."}
          </p>
        ) : (
          <p className="mt-2 text-[0.875rem] text-cream-400">
            Você vê os {episodiosGratis} primeiros episódios de cada novela.
            {status === "EXPIRED"
              ? " Sua assinatura anterior venceu."
              : ""}
          </p>
        )}

        {premium && !canceladaNoFim ? (
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
                      {pagamento.metodo ? ` · ${pagamento.metodo}` : ""}
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
