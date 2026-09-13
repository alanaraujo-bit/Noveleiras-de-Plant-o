import Link from "next/link";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import {
  PainelDeNotificacoes,
  type ConfigVisivel,
  type ExemploDeEvento,
} from "@/components/painel/Notificacoes";
import { Bloco, Selo, Tabela, Td, Th, Vazio } from "@/components/painel/primitivos";
import {
  baseDoApp,
  coletarFatos,
  coletarRelatorio,
  historicoDeEntregas,
  lerConfig,
  ultimosCadastros,
} from "@/lib/painel/discord/dados";
import { ultimaJanelaFechada } from "@/lib/painel/discord/janelas";
import {
  LISTA_DE_EVENTOS,
  mensagemDoRelatorio,
  mensagensDosFatos,
  TIPOS_DE_EVENTO,
  type Fato,
  type TipoDeEvento,
} from "@/lib/painel/discord/mensagens";
import { exigirPermissao } from "@/lib/painel/guarda";
import { fmtDataHora, fmtDesde } from "@/lib/painel/numeros";

export const metadata = { title: "Notificações" };

/** Mostra que existe um webhook, sem entregá-lo. */
function mascarar(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/webhooks\/(\d+)\/([\w-]+)/);
  if (!m) return "webhook salvo";
  const [, id, token] = m;
  return `discord.com/api/webhooks/${id.slice(0, 4)}…${id.slice(-4)}/••••••${token.slice(-4)}`;
}

/**
 * Quando um tipo de aviso nunca aconteceu, a prévia precisa de alguém para
 * mostrar. O exemplo é marcado como tal na tela — nunca passa por real.
 */
function exemploInventado(tipo: TipoDeEvento): Fato {
  const em = new Date();
  const pessoa = { userId: "exemplo", nome: "Maria Aparecida", email: "maria@exemplo.com" };
  switch (tipo) {
    case "cadastro":
      return { tipo, chave: "x", ...pessoa, metodo: "google", aparelho: "Android · Chrome (app instalado)", origem: "instagram.com", em, totalDeContas: 128 };
    case "assinatura":
    case "renovacao":
      return { tipo, chave: "x", ...pessoa, plano: "Mensal", valorCents: 1990, meio: "Pix", em };
    case "compra":
      return { tipo, chave: "x", ...pessoa, novela: "A Favorita", valorCents: 990, em };
    case "cancelamento":
      return { tipo, chave: "x", ...pessoa, plano: "Mensal", acessoAte: new Date(Date.now() + 12 * 86_400_000), em };
    case "falha":
      return { tipo, chave: "x", ...pessoa, plano: "Mensal", motivo: "Cartão recusado pelo emissor", em };
    case "alerta":
      return { tipo, chave: "x", titulo: "Servidor de mídia parou de responder", detalhe: "Nenhum batimento há mais de 3 minutos.", em };
  }
}

const ROTULO_DO_TIPO: Record<string, string> = {
  ...Object.fromEntries(LISTA_DE_EVENTOS.map((t) => [t, TIPOS_DE_EVENTO[t].rotulo])),
  relatorio: "Relatório",
  teste: "Teste",
};

export default async function PaginaDeNotificacoes() {
  const operador = await exigirPermissao("notificacoes.ver");
  const podeGerenciar = operador.pode("notificacoes.gerenciar");

  const { tabelaPronta, config } = await lerConfig();
  const base = baseDoApp();
  const janela = ultimaJanelaFechada(config.relatorioIntervalo, config.relatorioHora);

  const [dadosDoRelatorio, recentes, cadastros, historico] = await Promise.all([
    coletarRelatorio(janela, config.relatorioIntervalo),
    coletarFatos({
      desde: new Date(Date.now() - 90 * 86_400_000),
      tipos: new Set(LISTA_DE_EVENTOS),
      limite: 3,
      maisRecentes: true,
    }),
    ultimosCadastros(15),
    historicoDeEntregas(25),
  ]);

  const exemplos: ExemploDeEvento[] = LISTA_DE_EVENTOS.map((tipo) => {
    const real = recentes.find((f) => f.tipo === tipo);
    const fato = real ?? exemploInventado(tipo);
    return { tipo, real: Boolean(real), mensagem: mensagensDosFatos([fato], base)[0] };
  });

  const visivel: ConfigVisivel = {
    temWebhook: Boolean(config.webhookUrl),
    webhookMascarado: mascarar(config.webhookUrl),
    ativo: config.ativo,
    eventos: config.eventos,
    relatorioAtivo: config.relatorioAtivo,
    relatorioIntervalo: config.relatorioIntervalo,
    relatorioHora: config.relatorioHora,
  };

  const ultimoEnvio = historico.find((h) => h.estado === "ENVIADO" && !h.teste);

  return (
    <>
      <Cabecalho
        titulo="Notificações"
        descricao={
          !tabelaPronta
            ? "Migração pendente — a prévia já usa dados reais, salvar ainda não"
            : config.ativo
              ? `Canal ligado · último envio ${fmtDesde(ultimoEnvio?.enviadoEm ?? null)}`
              : "Canal desligado — nada é enviado ao Discord"
        }
      />

      <Conteudo className="space-y-5">
        {!tabelaPronta ? (
          <p className="rounded-lg border border-[var(--p-atencao)]/30 bg-[var(--p-atencao-fundo)] px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--p-atencao)]">
            As tabelas <code>DiscordConfig</code> e <code>DiscordEntrega</code>{" "}
            ainda não existem neste banco. A prévia e a lista de cadastros
            funcionam; salvar a configuração e enviar ficam disponíveis assim
            que a migração <code>20260913090000_notificacoes_discord</code> for
            aplicada (o deploy aplica sozinho).
          </p>
        ) : null}

        <PainelDeNotificacoes
          podeGerenciar={podeGerenciar}
          tabelaPronta={tabelaPronta}
          config={visivel}
          previaInicial={mensagemDoRelatorio(dadosDoRelatorio, base)}
          exemplos={exemplos}
        />

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
          <Bloco
            titulo="Quem chegou"
            descricao="As últimas contas criadas — contas de demonstração ficam de fora"
            acao={
              <Link
                href="/painel/usuarios"
                className="text-[0.75rem] text-[var(--p-suave)] hover:text-[var(--p-texto)]"
              >
                Todos os usuários →
              </Link>
            }
            compacto
          >
            {cadastros.length === 0 ? (
              <Vazio
                titulo="Ninguém se cadastrou ainda"
                descricao="Assim que a primeira conta for criada, ela aparece aqui — e no canal, se o aviso de cadastro estiver marcado."
              />
            ) : (
              <Tabela
                className="-mx-4 -mb-4"
                cabecalho={
                  <tr>
                    <Th>Pessoa</Th>
                    <Th>Entrou por</Th>
                    <Th>Aparelho</Th>
                    <Th>Plano</Th>
                    <Th alinhar="direita">Quando</Th>
                  </tr>
                }
              >
                {cadastros.map((c) => (
                  <tr key={c.id}>
                    <Td className="max-w-[16rem]">
                      <Link
                        href={`/painel/usuarios/${c.id}`}
                        className="block truncate text-[var(--p-texto)] hover:underline"
                      >
                        {c.nome}
                      </Link>
                      <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                        {c.email}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-[var(--p-suave)]">
                      {c.metodo === "google" ? "Google" : "E-mail"}
                    </Td>
                    <Td className="max-w-[12rem] truncate text-[var(--p-suave)]">
                      {c.aparelho ?? "—"}
                    </Td>
                    <Td>
                      <Selo tom={c.assinante ? "bom" : "neutro"}>{c.plano}</Selo>
                    </Td>
                    <Td alinhar="direita" className="whitespace-nowrap text-[var(--p-suave)]">
                      <span title={fmtDataHora(c.criadoEm)}>{fmtDesde(c.criadoEm)}</span>
                    </Td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Bloco>

          <Bloco
            titulo="O que já foi enviado"
            descricao="Cada mensagem tem uma chave; a mesma chave nunca sai duas vezes"
            compacto
          >
            {historico.length === 0 ? (
              <Vazio
                titulo="Nada enviado ainda"
                descricao={
                  tabelaPronta
                    ? "Cole o webhook, mande um teste e ligue o canal. Cada envio aparece aqui, com o erro quando o Discord recusar."
                    : "O histórico começa depois que a migração for aplicada."
                }
              />
            ) : (
              <ul className="-my-1 divide-y divide-[var(--p-linha)]">
                {historico.map((h) => (
                  <li key={h.id} className="flex items-start gap-2.5 py-2">
                    <Selo
                      tom={
                        h.estado === "ENVIADO"
                          ? "bom"
                          : h.estado === "FALHOU"
                            ? "perigo"
                            : "neutro"
                      }
                    >
                      {h.estado === "ENVIADO"
                        ? "enviado"
                        : h.estado === "FALHOU"
                          ? "falhou"
                          : "enviando"}
                    </Selo>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8125rem] text-[var(--p-texto)]">
                        {h.resumo ?? ROTULO_DO_TIPO[h.tipo] ?? h.tipo}
                      </p>
                      {h.erro ? (
                        <p className="truncate text-[0.6875rem] text-[var(--p-perigo)]" title={h.erro}>
                          {h.erro}
                          {h.tentativas > 1 ? ` · ${h.tentativas} tentativas` : ""}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className="shrink-0 text-[0.6875rem] whitespace-nowrap text-[var(--p-fraco)]"
                      title={fmtDataHora(h.enviadoEm ?? h.criadoEm)}
                    >
                      {fmtDesde(h.enviadoEm ?? h.criadoEm)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>
      </Conteudo>
    </>
  );
}
