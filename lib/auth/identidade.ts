/**
 * Como a pessoa aparece: nome e @.
 *
 * Funções puras — o campo do navegador valida com as mesmas regras que o
 * servidor, então a mensagem que a pessoa lê enquanto digita é a mesma que
 * barraria o envio. Só a disponibilidade depende do banco (`handles.ts`).
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const NOME_MIN = 2;
export const NOME_MAX = 60;

/** Nomes que fariam alguém se passar pela casa. Comparados sem ponto e _. */
const RESERVADOS = new Set([
  "admin",
  "administrador",
  "adm",
  "suporte",
  "ajuda",
  "noveleiras",
  "noveleirasdeplantao",
  "plantao",
  "painel",
  "oficial",
  "moderacao",
  "moderador",
  "equipe",
  "sistema",
  "root",
  "api",
  "null",
  "undefined",
]);

const CONECTIVOS = new Set(["da", "de", "do", "das", "dos", "e", "di", "du"]);

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** O que a pessoa digitou, do jeito que o @ é guardado: minúsculo, sem "@". */
export function normalizarHandle(entrada: string): string {
  return entrada.trim().replace(/^@+/, "").toLowerCase();
}

export type ValidacaoDoHandle =
  | { ok: true; handle: string }
  | { ok: false; erro: string };

export function validarHandle(entrada: string): ValidacaoDoHandle {
  const handle = normalizarHandle(entrada);
  if (handle.length < HANDLE_MIN) {
    return { ok: false, erro: `Use pelo menos ${HANDLE_MIN} caracteres.` };
  }
  if (handle.length > HANDLE_MAX) {
    return { ok: false, erro: `No máximo ${HANDLE_MAX} caracteres.` };
  }
  if (!/^[a-z0-9._]+$/.test(handle)) {
    return { ok: false, erro: "Só letras sem acento, números, ponto e _." };
  }
  if (/^[._]|[._]$/.test(handle)) {
    return { ok: false, erro: "Não pode começar nem terminar com ponto ou _." };
  }
  if (/[._]{2}/.test(handle)) {
    return { ok: false, erro: "Evite dois símbolos seguidos." };
  }
  if (!/[a-z]/.test(handle)) {
    return { ok: false, erro: "Precisa ter pelo menos uma letra." };
  }
  if (RESERVADOS.has(handle.replace(/[._]/g, ""))) {
    return { ok: false, erro: "Esse nome é reservado." };
  }
  return { ok: true, handle };
}

/**
 * Arruma o nome que veio de fora (o Google devolve o que a pessoa escreveu
 * lá, às vezes todo em maiúsculas ou todo em minúsculas).
 *
 * Só mexe em maiúsculas quando o nome inteiro está numa caixa só: "MARIA DA
 * SILVA" vira "Maria da Silva", mas "Maria McDonald" fica como está — quem
 * escreveu com cuidado não pode ter o nome "corrigido".
 */
export function limparNome(nome: string): string {
  const junto = nome
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOME_MAX);

  const letras = junto.replace(/[^\p{L}]/gu, "");
  const numaCaixaSo =
    letras.length > 0 &&
    (letras === letras.toUpperCase() || letras === letras.toLowerCase());
  if (!numaCaixaSo) return junto;

  return junto
    .toLowerCase()
    .split(" ")
    .map((parte, i) =>
      i > 0 && CONECTIVOS.has(parte)
        ? parte
        : parte.charAt(0).toUpperCase() + parte.slice(1),
    )
    .join(" ");
}

export type ValidacaoDoNome = { ok: true; nome: string } | { ok: false; erro: string };

export function validarNome(entrada: string): ValidacaoDoNome {
  const nome = limparNome(entrada);
  if (nome.length < NOME_MIN) return { ok: false, erro: "Como podemos te chamar?" };
  if (!/\p{L}/u.test(nome)) return { ok: false, erro: "O nome precisa ter letras." };
  return { ok: true, nome };
}

/**
 * Sugestões de @ a partir do nome, da mais bonita para a mais disponível:
 * "Maria Aparecida da Silva" → maria.silva, mariasilva, maria, maria_silva.
 * Nada de número aleatório no fim — isso é o que deixava o @ com cara de robô.
 */
export function candidatosDeHandle(nome: string): string[] {
  const partes = semAcento(nome)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p && !CONECTIVOS.has(p));
  if (partes.length === 0) return [];

  const primeiro = partes[0];
  const ultimo = partes.length > 1 ? partes[partes.length - 1] : null;

  const brutos = ultimo
    ? [`${primeiro}.${ultimo}`, `${primeiro}${ultimo}`, primeiro, `${primeiro}_${ultimo}`]
    : [primeiro];

  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of brutos) {
    const cortado = bruto.slice(0, HANDLE_MAX).replace(/[._]+$/, "");
    if (vistos.has(cortado) || !validarHandle(cortado).ok) continue;
    vistos.add(cortado);
    saida.push(cortado);
  }
  return saida;
}
