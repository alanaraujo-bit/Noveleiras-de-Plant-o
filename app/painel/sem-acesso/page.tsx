import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, LinkPainel } from "@/components/painel/primitivos";
import { exigirPainel } from "@/lib/painel/guarda";
import { PERMISSOES, type Permissao } from "@/lib/painel/permissoes";
import { navegacaoPara } from "@/lib/painel/navegacao";

export const metadata = { title: "Sem acesso" };

/**
 * A tela de permissão faltante.
 *
 * Diz **qual** permissão falta e para quem pedir. Um 403 mudo dentro de uma
 * equipe só gera a mesma pergunta no chat cinco minutos depois.
 */
export default async function SemAcesso({
  searchParams,
}: {
  searchParams: Promise<{ permissao?: string }>;
}) {
  const operador = await exigirPainel();
  const { permissao } = await searchParams;

  const descricao =
    permissao && permissao in PERMISSOES
      ? PERMISSOES[permissao as Permissao]
      : null;

  const primeiroDisponivel = navegacaoPara(operador.permissoes)[0]?.itens[0];

  return (
    <>
      <Cabecalho titulo="Essa área não está liberada para você" />
      <Conteudo>
        <Bloco>
          <div className="max-w-xl space-y-4">
            <p className="text-[0.9375rem] leading-relaxed text-[var(--p-suave)]">
              {descricao ? (
                <>
                  Para abrir esta tela é preciso a permissão{" "}
                  <code className="rounded bg-white/8 px-1.5 py-0.5 text-[0.8125rem] text-[var(--p-texto)]">
                    {permissao}
                  </code>{" "}
                  — {descricao.toLowerCase()}.
                </>
              ) : (
                "Você chegou a uma área que a sua conta não alcança."
              )}
            </p>
            <p className="text-[0.875rem] leading-relaxed text-[var(--p-fraco)]">
              Quem tem a permissão <code className="text-[var(--p-suave)]">admins.gerenciar</code>{" "}
              pode conceder isso em Administradores. Você continua com as{" "}
              {operador.permissoes.length} permissões que já tinha — nada mudou
              na sua conta.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {primeiroDisponivel ? (
                <LinkPainel href={primeiroDisponivel.href} variante="principal">
                  Ir para {primeiroDisponivel.rotulo}
                </LinkPainel>
              ) : null}
              <LinkPainel href="/inicio">Voltar ao aplicativo</LinkPainel>
            </div>
          </div>
        </Bloco>
      </Conteudo>
    </>
  );
}
