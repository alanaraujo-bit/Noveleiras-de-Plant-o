/**
 * Concede e revoga acesso ao painel pela linha de comando.
 *
 * Existe por causa do problema do primeiro administrador: a tela de
 * administradores exige a permissão `admins.gerenciar`, que só um
 * administrador pode conceder. Alguém precisa abrir a porta de fora — e é
 * melhor que seja um comando explícito, rodado por quem tem acesso ao banco,
 * do que uma rota escondida no aplicativo.
 *
 *   npm run admin -- listar
 *   npm run admin -- promover pessoa@email.com
 *   npm run admin -- promover pessoa@email.com --perfil=editorial
 *   npm run admin -- rebaixar pessoa@email.com
 */
import { PrismaClient } from "@prisma/client";

import { PERFIS, TODAS_PERMISSOES } from "../lib/painel/permissoes.ts";

const db = new PrismaClient();

function sair(mensagem: string): never {
  console.error(`\n  ${mensagem}\n`);
  process.exit(1);
}

async function listar() {
  const equipe = await db.user.findMany({
    where: { role: { in: ["ADMIN", "EDITOR"] } },
    select: {
      email: true,
      name: true,
      role: true,
      status: true,
      permissions: true,
      lastSeenAt: true,
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  if (equipe.length === 0) {
    console.log("\n  Ninguém tem acesso ao painel ainda.");
    console.log("  Conceda com: npm run admin -- promover seu@email.com\n");
    return;
  }

  console.log(`\n  ${equipe.length} pessoa(s) com acesso ao painel:\n`);
  for (const pessoa of equipe) {
    const quantas =
      pessoa.role === "ADMIN"
        ? `todas (${TODAS_PERMISSOES.length})`
        : `${pessoa.permissions.length}`;
    console.log(
      `  ${pessoa.role.padEnd(6)} ${pessoa.email.padEnd(34)} ` +
        `permissões: ${quantas}${pessoa.status !== "ACTIVE" ? ` · ${pessoa.status}` : ""}`,
    );
  }
  console.log();
}

async function promover(email: string, perfil: string | null) {
  const pessoa = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, role: true },
  });
  if (!pessoa) sair(`Nenhuma conta com o e-mail ${email}.`);

  if (perfil && !(perfil in PERFIS)) {
    sair(`Perfil desconhecido: ${perfil}. Use ${Object.keys(PERFIS).join(", ")}.`);
  }

  // Sem perfil = acesso completo (ADMIN). Com perfil = EDITOR com a lista dele.
  const dados = perfil
    ? { role: "EDITOR" as const, permissions: PERFIS[perfil].permissoes as string[] }
    : { role: "ADMIN" as const, permissions: [] };

  await db.user.update({ where: { id: pessoa.id }, data: dados });

  console.log(
    `\n  ${pessoa.name} <${email}> agora é ${dados.role}` +
      `${perfil ? ` com o perfil "${PERFIS[perfil].nome}"` : " com acesso completo"}.\n`,
  );
}

async function rebaixar(email: string) {
  const pessoa = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, role: true },
  });
  if (!pessoa) sair(`Nenhuma conta com o e-mail ${email}.`);

  if (pessoa.role === "ADMIN") {
    const outros = await db.user.count({
      where: { role: "ADMIN", status: "ACTIVE", id: { not: pessoa.id } },
    });
    // Deixar a operação sem nenhum administrador ativo tranca todo mundo do
    // lado de fora, e a única saída seria mexer no banco na mão.
    if (outros === 0) sair("Esse é o único administrador ativo. Promova outro antes.");
  }

  await db.user.update({
    where: { id: pessoa.id },
    data: { role: "USER", permissions: [] },
  });
  console.log(`\n  ${pessoa.name} <${email}> não tem mais acesso ao painel.\n`);
}

async function main() {
  const [comando, alvo, ...resto] = process.argv.slice(2);
  const perfil =
    resto.find((a) => a.startsWith("--perfil="))?.split("=")[1] ?? null;

  switch (comando) {
    case "listar":
      return listar();
    case "promover":
      if (!alvo) sair("Informe o e-mail. Ex.: npm run admin -- promover voce@email.com");
      return promover(alvo, perfil);
    case "rebaixar":
      if (!alvo) sair("Informe o e-mail.");
      return rebaixar(alvo);
    default:
      sair(
        "Comandos: listar | promover <email> [--perfil=observador|editorial|operacao|completo] | rebaixar <email>",
      );
  }
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
