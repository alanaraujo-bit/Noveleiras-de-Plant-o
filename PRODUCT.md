# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Público final: pessoas que acompanham novelas verticais brasileiras no celular e querem assistir, retomar, descobrir títulos e participar da comunidade.
- Operação: administradores e editores que precisam observar audiência, conteúdo, mídia, infraestrutura, receita e incidentes sem confundir dados reais com material de demonstração.

## Product Purpose

Noveleiras de Plantão é uma PWA mobile-first de streaming e comunidade para novelas verticais brasileiras. O painel administrativo transforma os fatos registrados pelo produto em decisões operacionais verificáveis. Sucesso significa uma experiência assistível para o público e uma operação capaz de investigar o que ocorreu, agir com autorização granular e reconstruir ações sensíveis.

## Positioning

O produto une streaming seriado vertical, descoberta e conversa de fãs no mesmo fluxo, com telemetria append-only e uma camada de mídia substituível que permitem operar o catálogo sem reescrever a experiência.

## Operating Context

- A aplicação pública roda na Vercel; o PostgreSQL roda na Railway.
- O painel vive em `/painel` e é usado como uma central de operações de alta densidade.
- O acesso administrativo é decidido no servidor por permissão granular; a navegação é conveniência, não autoridade.
- A operação investiga por período, desce de novelas para temporadas e episódios e precisa copiar IDs, e-mails e mensagens de erro.

## Capabilities and Constraints

- Stack existente: Next.js 16.3.4, React 19, Prisma 6 e PostgreSQL.
- Métricas do painel derivam apenas de fatos: `Event`, `WatchProgress`, `AppSession`, `SearchQuery`, `Subscription` e `Payment`. Contadores denormalizados do seed não são fonte analítica.
- Datas do banco são UTC em colunas sem fuso; agregações de calendário usam o horário de Brasília pela fronteira `lib/painel/tempo.ts`.
- `Event` mantém IDs soltos de novela e episódio; títulos são resolvidos em lote.
- Valores `BigInt` são convertidos para `Number` na fronteira do repositório.
- Valores de assinatura ausentes podem usar fallback de plano, mas toda estimativa precisa ser declarada na interface.
- Ações sensíveis exigem confirmação protegida e auditoria com estado anterior e posterior.
- A camada de mídia trabalha com chaves opacas e provedores, nunca com URLs espalhadas pela interface.
- Dados e conteúdo do seed são demonstração e devem ser identificados como tal.

## Brand Commitments

- Nome: Noveleiras de Plantão.
- Voz em português brasileiro, direta, humana e operacional; rótulos dizem o que aconteceu e o que fazer.
- A identidade pública usa vinho, carmim e ouro. O painel preserva essa identidade numa temperatura mais fria e escura, como uma sala de controle ao lado de um teatro.

## Evidence on Hand

- Catálogo e contas de demonstração no seed, explicitamente fictícios.
- Eventos, sessões, progresso, buscas, assinaturas e pagamentos armazenados no banco são as fontes factuais do painel.
- Componentes e estilos existentes em `components/painel/` e `app/painel.css` são a autoridade visual para novas telas administrativas.
- Não há depoimentos, benchmarks externos ou alegações comerciais aprovadas; não fabricar esses elementos.

## Product Principles

1. Fatos antes de contadores: toda métrica deve ser reconstruível a partir do evento ou estado normalizado que a originou.
2. Honestidade visível: estimativas, cobertura parcial e dados de demonstração aparecem como tais na mesma tela que o número.
3. Autoridade no servidor: esconder um controle nunca substitui validar a permissão na leitura ou na ação.
4. Investigação contínua: resumos devem conduzir ao detalhe relevante sem perder período, contexto ou identidade do alvo.
5. Operação recuperável: estados vazios, falhas e ações sensíveis precisam explicar causa, consequência e próximo passo.

## Accessibility & Inclusion

- O painel deve funcionar por teclado, manter foco visível, não depender apenas de cor e respeitar redução de movimento.
- Texto operacional permanece selecionável, tabelas preservam rolagem visível e números usam alinhamento tabular.
