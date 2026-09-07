import type { Permissao } from "@/lib/painel/permissoes";

/**
 * Mapa do painel.
 *
 * Cada item carrega a permissão que a sua página exige. O menu é montado a
 * partir daqui e a página exige a mesma constante — então "está no menu" e
 * "consigo abrir" nunca divergem. Um item sem permissão correspondente some
 * do menu; tentar a URL na mão continua esbarrando na guarda do servidor.
 */

export type ItemDeNavegacao = {
  href: string;
  rotulo: string;
  permissao: Permissao;
  /** Nome do ícone em `components/painel/icones.tsx`. */
  icone:
    | "painel"
    | "alertas"
    | "usuarios"
    | "streaming"
    | "busca"
    | "catalogo"
    | "midia"
    | "comunidade"
    | "servidor"
    | "transcode"
    | "financeiro"
    | "logs"
    | "auditoria"
    | "admin";
  /** Descrição curta para a busca global do painel. */
  descricao: string;
};

export type GrupoDeNavegacao = {
  titulo: string;
  itens: ItemDeNavegacao[];
};

export const NAVEGACAO: GrupoDeNavegacao[] = [
  {
    titulo: "Operação",
    itens: [
      {
        href: "/painel",
        rotulo: "Visão geral",
        permissao: "visao.ver",
        icone: "painel",
        descricao: "O que está acontecendo agora e no período",
      },
      {
        href: "/painel/alertas",
        rotulo: "Alertas",
        permissao: "alertas.ver",
        icone: "alertas",
        descricao: "Incidentes abertos e o que exige atenção",
      },
    ],
  },
  {
    titulo: "Audiência",
    itens: [
      {
        href: "/painel/usuarios",
        rotulo: "Usuários",
        permissao: "usuarios.ver",
        icone: "usuarios",
        descricao: "Quem usa, com que frequência e por quanto tempo",
      },
      {
        href: "/painel/streaming",
        rotulo: "Streaming",
        permissao: "streaming.ver",
        icone: "streaming",
        descricao: "Reproduções, conclusão, abandono e simultaneidade",
      },
      {
        href: "/painel/descoberta",
        rotulo: "Descoberta",
        permissao: "busca.ver",
        icone: "busca",
        descricao: "O que buscam e o que não encontram",
      },
    ],
  },
  {
    titulo: "Conteúdo",
    itens: [
      {
        href: "/painel/catalogo",
        rotulo: "Catálogo",
        permissao: "catalogo.ver",
        icone: "catalogo",
        descricao: "Novelas, temporadas e episódios",
      },
      {
        href: "/painel/midia",
        rotulo: "Mídia",
        permissao: "midia.ver",
        icone: "midia",
        descricao: "Arquivos, integridade e armazenamento",
      },
      {
        href: "/painel/comunidade",
        rotulo: "Comunidade",
        permissao: "comunidade.ver",
        icone: "comunidade",
        descricao: "Publicações, comentários e denúncias",
      },
    ],
  },
  {
    titulo: "Infraestrutura",
    itens: [
      {
        href: "/painel/servidor",
        rotulo: "Servidor",
        permissao: "servidor.ver",
        icone: "servidor",
        descricao: "Saúde, recursos e controles do servidor de mídia",
      },
      {
        href: "/painel/transcodificacao",
        rotulo: "Transcodificação",
        permissao: "transcode.ver",
        icone: "transcode",
        descricao: "Fila, progresso e falhas de preparação de vídeo",
      },
    ],
  },
  {
    titulo: "Negócio",
    itens: [
      {
        href: "/painel/financeiro",
        rotulo: "Financeiro",
        permissao: "financeiro.ver",
        icone: "financeiro",
        descricao: "Assinaturas, receita, MRR e pagamentos",
      },
    ],
  },
  {
    titulo: "Registro",
    itens: [
      {
        href: "/painel/logs",
        rotulo: "Logs",
        permissao: "logs.ver",
        icone: "logs",
        descricao: "O que o sistema fez, por canal e severidade",
      },
      {
        href: "/painel/auditoria",
        rotulo: "Auditoria",
        permissao: "auditoria.ver",
        icone: "auditoria",
        descricao: "Quem fez o quê, quando e sobre qual alvo",
      },
      {
        href: "/painel/administradores",
        rotulo: "Administradores",
        permissao: "admins.ver",
        icone: "admin",
        descricao: "Quem tem acesso ao painel e até onde",
      },
    ],
  },
];

/** Só os grupos e itens que a pessoa pode abrir. */
export function navegacaoPara(
  permissoes: readonly Permissao[],
): GrupoDeNavegacao[] {
  return NAVEGACAO.map((grupo) => ({
    ...grupo,
    itens: grupo.itens.filter((item) => permissoes.includes(item.permissao)),
  })).filter((grupo) => grupo.itens.length > 0);
}

export const TODOS_OS_ITENS = NAVEGACAO.flatMap((grupo) => grupo.itens);
