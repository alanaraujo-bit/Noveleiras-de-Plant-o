/**
 * Catálogo de permissões do painel.
 *
 * `Role` decide quem entra no painel. Este catálogo decide o que cada pessoa
 * alcança lá dentro — nem todo administrador precisa mexer em financeiro ou
 * reiniciar servidor.
 *
 * A lista é tipada de propósito: uma permissão escrita errado vira erro de
 * compilação, não uma tela que ninguém consegue abrir e ninguém entende por
 * quê. Ela vive em código (e não em tabela) porque muda junto com as telas —
 * uma permissão sem tela é inútil, e uma tela sem permissão é um buraco.
 */

export const PERMISSOES = {
  "visao.ver": "Ver a visão geral",

  "usuarios.ver": "Ver usuários e fichas individuais",
  "usuarios.editar": "Editar conta, status e plano de usuários",

  "streaming.ver": "Ver consumo, reproduções e desempenho de conteúdo",

  "catalogo.ver": "Ver o catálogo",
  "catalogo.editar": "Criar e editar novelas, temporadas e episódios",
  "catalogo.publicar": "Publicar, agendar, destacar e despublicar",

  "midia.ver": "Ver arquivos, integridade e armazenamento",
  "midia.gerenciar": "Associar, reprocessar e corrigir mídia",

  "servidor.ver": "Ver saúde dos servidores de mídia",
  "servidor.controlar": "Executar ações no servidor (reiniciar, testar, parar)",

  "transcode.ver": "Ver a fila de transcodificação",
  "transcode.gerenciar": "Enfileirar, priorizar e cancelar trabalhos",

  "financeiro.ver": "Ver assinaturas, receita e pagamentos",
  "financeiro.gerenciar": "Alterar planos, registrar reembolsos",

  "comunidade.ver": "Ver posts, comentários e denúncias",
  "comunidade.moderar": "Ocultar conteúdo e resolver denúncias",

  "busca.ver": "Ver termos buscados e demanda",

  "logs.ver": "Consultar a central de logs",
  "auditoria.ver": "Consultar o registro de ações administrativas",

  "alertas.ver": "Ver alertas e incidentes",
  "alertas.gerenciar": "Reconhecer e resolver alertas",

  "admins.ver": "Ver administradores e suas permissões",
  "admins.gerenciar": "Conceder e revogar acesso administrativo",
} as const;

export type Permissao = keyof typeof PERMISSOES;

export const TODAS_PERMISSOES = Object.keys(PERMISSOES) as Permissao[];

/**
 * Agrupamento para a tela de administradores — a mesma ordem da navegação,
 * para que conceder acesso se pareça com o painel que a pessoa vai ver.
 */
export const GRUPOS_DE_PERMISSAO: {
  titulo: string;
  permissoes: Permissao[];
}[] = [
  { titulo: "Visão geral", permissoes: ["visao.ver"] },
  { titulo: "Usuários", permissoes: ["usuarios.ver", "usuarios.editar"] },
  { titulo: "Streaming", permissoes: ["streaming.ver"] },
  {
    titulo: "Catálogo",
    permissoes: ["catalogo.ver", "catalogo.editar", "catalogo.publicar"],
  },
  { titulo: "Mídia", permissoes: ["midia.ver", "midia.gerenciar"] },
  { titulo: "Servidor", permissoes: ["servidor.ver", "servidor.controlar"] },
  {
    titulo: "Transcodificação",
    permissoes: ["transcode.ver", "transcode.gerenciar"],
  },
  {
    titulo: "Financeiro",
    permissoes: ["financeiro.ver", "financeiro.gerenciar"],
  },
  {
    titulo: "Comunidade",
    permissoes: ["comunidade.ver", "comunidade.moderar"],
  },
  { titulo: "Descoberta", permissoes: ["busca.ver"] },
  { titulo: "Observabilidade", permissoes: ["logs.ver", "auditoria.ver"] },
  { titulo: "Alertas", permissoes: ["alertas.ver", "alertas.gerenciar"] },
  { titulo: "Administração", permissoes: ["admins.ver", "admins.gerenciar"] },
];

/**
 * Perfis prontos. Existem para que conceder acesso não obrigue a marcar trinta
 * caixas — mas a permissão continua sendo a unidade real, e o perfil é só um
 * atalho que preenche a lista.
 */
export const PERFIS: Record<
  string,
  { nome: string; descricao: string; permissoes: Permissao[] }
> = {
  observador: {
    nome: "Observador",
    descricao: "Enxerga tudo, não altera nada.",
    permissoes: TODAS_PERMISSOES.filter((p) => p.endsWith(".ver")),
  },
  editorial: {
    nome: "Editorial",
    descricao: "Cuida do catálogo, da mídia e da comunidade.",
    permissoes: [
      "visao.ver",
      "streaming.ver",
      "catalogo.ver",
      "catalogo.editar",
      "catalogo.publicar",
      "midia.ver",
      "midia.gerenciar",
      "comunidade.ver",
      "comunidade.moderar",
      "busca.ver",
      "transcode.ver",
    ],
  },
  operacao: {
    nome: "Operação",
    descricao: "Cuida de servidor, transcodificação, logs e incidentes.",
    permissoes: [
      "visao.ver",
      "streaming.ver",
      "midia.ver",
      "midia.gerenciar",
      "servidor.ver",
      "servidor.controlar",
      "transcode.ver",
      "transcode.gerenciar",
      "logs.ver",
      "auditoria.ver",
      "alertas.ver",
      "alertas.gerenciar",
    ],
  },
  completo: {
    nome: "Acesso completo",
    descricao: "Tudo, inclusive conceder acesso a outras pessoas.",
    permissoes: TODAS_PERMISSOES,
  },
};

/**
 * ADMIN tem tudo por definição — caso contrário seria possível fechar a porta
 * atrás de si mesmo e deixar a operação sem ninguém que possa reabrir.
 * EDITOR recebe o perfil editorial quando nada foi concedido explicitamente.
 */
export function permissoesEfetivas(
  role: "USER" | "EDITOR" | "ADMIN",
  concedidas: string[],
): Permissao[] {
  if (role === "ADMIN") return TODAS_PERMISSOES;
  const validas = concedidas.filter((p): p is Permissao => p in PERMISSOES);
  if (role === "EDITOR" && validas.length === 0) return PERFIS.editorial.permissoes;
  return validas;
}

export function temPermissao(
  efetivas: readonly Permissao[],
  exigida: Permissao,
): boolean {
  return efetivas.includes(exigida);
}
