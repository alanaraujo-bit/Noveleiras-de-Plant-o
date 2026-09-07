---
version: 1
slug: "app-painel-descoberta-page-tsx"
primary_target: "app/painel/descoberta/page.tsx"
related_targets: ["app/painel/descoberta/[termo]/page.tsx","components/painel/Descoberta.tsx"]
---

## Scope and mode

`/painel/descoberta` e o detalhe de um termo buscado. Modo Operate.

## Audience and job

Administradores e editores leem a demanda declarada pelo público: o que as pessoas procuram, o que o catálogo devolve e o que volta vazio. A tela existe para virar decisão de catálogo, não para exibir volume de busca.

## Task and content

Fonte factual única: `SearchQuery`. Agrupamento pela forma normalizada; a grafia original aparece como evidência de como a pessoa escreveu. O recorte temporal permanece na URL do resumo ao termo. Filtro, ordenação e página vivem na URL para que uma investigação seja compartilhável.

## Direction and memorable moment

Mesma gramática da fatia de Streaming — curva temporal à esquerda, livro-razão à direita, tabela conduzindo ao próximo nível. O momento próprio desta tela é o par de rankings "Procuraram e não acharam" / "Para onde a busca leva": demanda frustrada e demanda atendida lado a lado, na mesma escala.

## Constraints

Horário de Brasília via `lib/painel/tempo.ts`; permissão `busca.ver` exigida no servidor antes de qualquer consulta; cobertura parcial declarada junto do número; termo na URL sempre codificado; link para a ficha de uma conta só aparece para quem tem `usuarios.ver`.
