/**
 * Registra e administra servidores de mídia.
 *
 * Existe pelo mesmo motivo que `scripts/admin.ts`: alguém precisa abrir a
 * porta de fora. Um servidor só passa a existir quando quem tem acesso ao
 * banco o registra e recebe o segredo — e o segredo aparece **uma vez**, aqui,
 * porque o banco guarda apenas o hash.
 *
 *   npm run servidor -- listar
 *   npm run servidor -- registrar casa "PC da sala"
 *   npm run servidor -- rotacionar casa
 *   npm run servidor -- desabilitar casa
 *   npm run servidor -- remover casa
 */
import { PrismaClient } from "@prisma/client";

import { gerarSegredo, hashDoSegredo, situacaoPorBatimento } from "../lib/painel/servidor.ts";

const db = new PrismaClient();

function sair(mensagem: string): never {
  console.error(`\n  ${mensagem}\n`);
  process.exit(1);
}

const ROTULO: Record<string, string> = {
  UNKNOWN: "sem notícia",
  ONLINE: "no ar",
  DEGRADED: "atrasado",
  OFFLINE: "fora do ar",
};

async function listar() {
  const servidores = await db.mediaServer.findMany({
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
    select: {
      slug: true,
      name: true,
      kind: true,
      status: true,
      enabled: true,
      lastBeatAt: true,
      agentVersion: true,
      _count: { select: { beats: true, assets: true } },
    },
  });

  if (servidores.length === 0) {
    console.log(
      "\n  Nenhum servidor registrado." +
        "\n  Registre o primeiro:  npm run servidor -- registrar casa \"PC da sala\"\n",
    );
    return;
  }

  console.log("");
  for (const servidor of servidores) {
    // A situação mostrada é derivada do silêncio, não da coluna: um servidor
    // que parou de bater não continua "no ar" porque o último batimento disse
    // que estava.
    const real = situacaoPorBatimento(servidor.lastBeatAt);
    console.log(
      `  ${servidor.enabled ? "·" : "×"} ${servidor.slug.padEnd(16)} ${servidor.name}`,
    );
    console.log(
      `      ${ROTULO[real]}` +
        (servidor.lastBeatAt
          ? ` · último batimento ${servidor.lastBeatAt.toISOString()}`
          : " · nunca bateu") +
        ` · ${servidor._count.beats} batimentos · ${servidor._count.assets} arquivos` +
        (servidor.agentVersion ? ` · agente ${servidor.agentVersion}` : ""),
    );
  }
  console.log("");
}

function mostrarSegredo(slug: string, segredo: string) {
  console.log(
    `\n  Segredo do servidor "${slug}" — aparece só desta vez:\n` +
      `\n      ${segredo}\n` +
      `\n  Guarde-o na máquina que serve a mídia, em .env.agente:\n` +
      `\n      AGENTE_SLUG="${slug}"` +
      `\n      AGENTE_SEGREDO="${segredo}"` +
      `\n      AGENTE_DESTINO="https://noveleiras-de-plantao.vercel.app"\n` +
      `\n  Depois rode lá:  npm run agente\n`,
  );
}

async function registrar(slug: string, nome: string, tipo: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) {
    sair("O slug usa letras minúsculas, números e hífen (2 a 40 caracteres).");
  }
  const existente = await db.mediaServer.findUnique({ where: { slug } });
  if (existente) sair(`Já existe um servidor com o slug "${slug}".`);

  const segredo = gerarSegredo();
  await db.mediaServer.create({
    data: { slug, name: nome, kind: tipo, tokenHash: hashDoSegredo(segredo) },
  });
  mostrarSegredo(slug, segredo);
}

async function rotacionar(slug: string) {
  const servidor = await db.mediaServer.findUnique({ where: { slug } });
  if (!servidor) sair(`Nenhum servidor com o slug "${slug}".`);

  const segredo = gerarSegredo();
  await db.mediaServer.update({
    where: { slug },
    data: { tokenHash: hashDoSegredo(segredo) },
  });
  console.log("\n  O segredo anterior deixou de valer agora.");
  mostrarSegredo(slug, segredo);
}

async function alternar(slug: string, habilitado: boolean) {
  const servidor = await db.mediaServer.findUnique({ where: { slug } });
  if (!servidor) sair(`Nenhum servidor com o slug "${slug}".`);
  await db.mediaServer.update({ where: { slug }, data: { enabled: habilitado } });
  console.log(
    `\n  ${servidor.name} ${habilitado ? "habilitado" : "desabilitado"}.` +
      (habilitado
        ? "\n"
        : "\n  Os batimentos passam a ser recusados; o histórico permanece.\n"),
  );
}

async function remover(slug: string) {
  const servidor = await db.mediaServer.findUnique({
    where: { slug },
    select: { name: true, _count: { select: { beats: true, assets: true } } },
  });
  if (!servidor) sair(`Nenhum servidor com o slug "${slug}".`);

  // Os arquivos ficam: `MediaAsset.serverId` é SetNull no schema, porque um
  // inventário não deve sumir junto com a máquina que o hospedava.
  await db.mediaServer.delete({ where: { slug } });
  console.log(
    `\n  ${servidor.name} removido.` +
      `\n  ${servidor._count.beats} batimentos foram junto;` +
      ` ${servidor._count.assets} arquivos continuam no inventário, sem servidor.\n`,
  );
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  switch (comando) {
    case "listar":
    case undefined:
      return listar();
    case "registrar": {
      const [slug, ...nome] = resto;
      if (!slug) sair('Uso: npm run servidor -- registrar <slug> "<nome>"');
      return registrar(slug, nome.join(" ") || slug, "LOCAL");
    }
    case "rotacionar":
      if (!resto[0]) sair("Uso: npm run servidor -- rotacionar <slug>");
      return rotacionar(resto[0]);
    case "habilitar":
      if (!resto[0]) sair("Uso: npm run servidor -- habilitar <slug>");
      return alternar(resto[0], true);
    case "desabilitar":
      if (!resto[0]) sair("Uso: npm run servidor -- desabilitar <slug>");
      return alternar(resto[0], false);
    case "remover":
      if (!resto[0]) sair("Uso: npm run servidor -- remover <slug>");
      return remover(resto[0]);
    default:
      sair(
        `Comando desconhecido: ${comando}\n` +
          "  listar | registrar | rotacionar | habilitar | desabilitar | remover",
      );
  }
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
