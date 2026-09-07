---
version: 1
slug: "app-painel-streaming-page-tsx"
primary_target: "app/painel/streaming/page.tsx"
related_targets: ["app/painel/streaming/[novelaId]/page.tsx","app/painel/streaming/[novelaId]/[temporadaId]/page.tsx","app/painel/streaming/[novelaId]/[temporadaId]/[episodioId]/page.tsx"]
---

## Scope and mode

`/painel/streaming` e o drill-down novela → temporada → episódio. Modo Operate.

## Audience and job

Administradores e editores investigam consumo, conclusão, abandono e falhas sem usar os contadores fictícios do catálogo.

## Task and content

O recorte temporal permanece na URL durante toda a descida. O resumo combina ritmo temporal, livro-razão de qualidade e tabela do próximo nível. `Event` e `WatchProgress` são as fontes factuais; títulos são resolvidos em lote.

## Direction and memorable moment

Extensão da sala de controle existente. A curva temporal mantém contexto enquanto a tabela transforma o catálogo em caminho investigável; o mesmo padrão reaparece em cada nível para comparação imediata.

## Constraints

Horário de Brasília via `lib/painel/tempo.ts`; permissões no servidor; cobertura parcial explícita; responsivo com seletor de período rolando dentro do cabeçalho e no máximo quatro marcas temporais no celular.
