import Link from "next/link";
import { redirect } from "next/navigation";

import { BotaoLink } from "@/components/ui/primitivos";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  reconciliarAssinatura,
  reconciliarPagamento,
} from "@/lib/pagamentos/servico";

export const metadata = { title: "Pagamento" };
export const dynamic = "force-dynamic";

/**
 * Retorno do checkout do provedor.
 *
 * É o endereço que vai em `back_url`, e existe como segmento estático de
 * propósito: antes, `/pagamento/retorno` caía em `/pagamento/[attemptId]`,
 * onde "retorno" era procurado como id de tentativa e a pessoa recebia 404
 * logo depois de pagar.
 *
 * **Esta página não decide nada a partir da URL.** O provedor devolve
 * `status=approved`, `collection_status` e afins na query string, e nada disso
 * é prova: qualquer pessoa digita esses parâmetros na barra de endereço. O que
 * a página faz é identificar a cobrança, mandar o servidor reconsultar o
 * provedor, e então entregar o resultado real à tela de estado — a mesma que
 * cobre aprovado, pendente, recusado e cancelado.
 *
 * A reconciliação aqui é redundante com o webhook, e isso é intencional: o
 * webhook pode demorar, e quem acabou de pagar está olhando a tela agora. As
 * duas convergem porque `reconciliarPagamento` é idempotente.
 */
export default async function RetornoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar?proximo=/perfil/assinatura");

  const params = await searchParams;
  const ler = (chave: string): string | null => {
    const bruto = params[chave];
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    return typeof valor === "string" && valor.trim() ? valor.trim() : null;
  };

  // `external_reference` é o nosso id de tentativa viajando dentro do objeto
  // do provedor. É o caminho confiável; os outros são reservas para os fluxos
  // em que ele não volta.
  const referencia = ler("external_reference");
  const preapprovalId = ler("preapproval_id");
  const pagamentoId = ler("payment_id") ?? ler("collection_id");
  const preferenciaId = ler("preference_id");

  const tentativa = await localizarTentativa(viewer.id, {
    referencia,
    preapprovalId,
    pagamentoId,
    preferenciaId,
  });

  if (!tentativa) return <NaoIdentificado />;

  // Reconsulta autenticada. Falhar aqui não pode travar a tela: o webhook
  // ainda vai chegar, e a tela de estado consulta de novo sozinha.
  try {
    const externo = pagamentoId ?? tentativa.externalId;
    if (externo && tentativa.kind === "PURCHASE") {
      await reconciliarPagamento(externo);
    } else {
      const preapproval = preapprovalId ?? tentativa.externalId;
      // A mesma rotina do webhook, e não um carimbo local: antes daqui saía
      // uma tentativa APROVADA sem assinatura e sem direito, e o acesso só
      // apareceria se o webhook chegasse — que é justamente o que pode não
      // acontecer.
      if (preapproval) await reconciliarAssinatura(preapproval);
    }
  } catch (erro) {
    console.error("[retorno] reconciliação falhou", erro);
  }

  // A tela de estado já cobre os quatro desfechos e continua consultando
  // enquanto o pagamento estiver pendente. Duplicá-la aqui só criaria duas
  // versões da mesma UX para divergirem com o tempo.
  redirect(`/pagamento/${tentativa.id}`);
}

type Pistas = {
  referencia: string | null;
  preapprovalId: string | null;
  pagamentoId: string | null;
  preferenciaId: string | null;
};

/**
 * Acha a tentativa desta pessoa a partir do que o provedor devolveu.
 *
 * Todas as buscas filtram por `userId`. Sem isso, colar o
 * `external_reference` de outra pessoa na URL mostraria a cobrança dela.
 */
async function localizarTentativa(userId: string, pistas: Pistas) {
  const selecao = {
    id: true,
    kind: true,
    externalId: true,
    purchaseId: true,
  } as const;

  if (pistas.referencia) {
    const achada = await db.paymentAttempt.findFirst({
      where: { id: pistas.referencia, userId },
      select: selecao,
    });
    if (achada) return achada;
  }

  const externos = [
    pistas.preapprovalId,
    pistas.pagamentoId,
    pistas.preferenciaId,
  ].filter((v): v is string => Boolean(v));

  if (externos.length > 0) {
    const achada = await db.paymentAttempt.findFirst({
      where: { userId, externalId: { in: externos } },
      select: selecao,
    });
    if (achada) return achada;
  }

  if (pistas.preferenciaId) {
    const compra = await db.purchase.findFirst({
      where: { userId, externalPreferenceId: pistas.preferenciaId },
      select: { id: true },
    });
    if (compra) {
      return db.paymentAttempt.findFirst({
        where: { userId, purchaseId: compra.id },
        orderBy: { createdAt: "desc" },
        select: selecao,
      });
    }
  }

  // Última tentativa em aberto desta pessoa. O provedor às vezes volta sem
  // parâmetro nenhum quando a pessoa desiste no meio do checkout.
  return db.paymentAttempt.findFirst({
    where: { userId, status: { in: ["CREATED", "PENDING"] } },
    orderBy: { createdAt: "desc" },
    select: selecao,
  });
}

/**
 * Nenhuma cobrança reconhecida.
 *
 * Acontece quando alguém abre o endereço direto, ou quando o provedor volta
 * sem parâmetro e a pessoa não tem tentativa em aberto. Dizer isso é melhor
 * que um 404 seco: quem chegou aqui pode ter acabado de pagar.
 */
function NaoIdentificado() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      style={{ paddingTop: "var(--safe-t)", paddingBottom: "var(--safe-b)" }}
    >
      <div className="flex w-full max-w-sm flex-col items-center">
        <div className="grid size-16 place-items-center rounded-full bg-white/8 text-2xl">
          ?
        </div>
        <h1 className="mt-5 text-[1.5rem] leading-tight">
          Não identificamos esta cobrança
        </h1>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-cream-400">
          Se você acabou de pagar, o acesso é liberado assim que o provedor
          confirmar — nada se perde. Seu histórico mostra a situação de cada
          cobrança.
        </p>

        <BotaoLink
          href="/perfil/assinatura"
          tamanho="grande"
          largura="cheia"
          className="mt-7"
        >
          Ver minha assinatura
        </BotaoLink>
        <Link
          href="/plantao"
          className="tap mt-3 py-2 text-[0.8125rem] text-cream-600 underline underline-offset-4"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
