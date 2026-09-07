import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy (o que o Next chamava de middleware até a versão 16).
 *
 * Faz **uma** coisa: quem chega em /painel sem nenhum cookie de sessão vai
 * direto para o login, em vez de esperar o servidor renderizar uma página que
 * só terminaria em redirecionamento.
 *
 * O que ele deliberadamente **não** faz: decidir se a pessoa é da equipe. Isso
 * exigiria ler o banco, e a própria documentação do Next desaconselha usar o
 * proxy como solução de autorização. Quem decide é `lib/painel/guarda.ts`,
 * chamado dentro de cada página, ação e rota do painel. Aqui é só atalho de
 * navegação — apagar este arquivo não abriria o painel para ninguém.
 */

const COOKIE_SESSAO = "nvl_sessao";

export function proxy(request: NextRequest) {
  if (request.cookies.has(COOKIE_SESSAO)) return NextResponse.next();

  const destino = new URL("/entrar", request.url);
  destino.searchParams.set(
    "destino",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(destino);
}

export const config = {
  matcher: ["/painel/:path*"],
};
