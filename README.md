# Noveleiras de Plantão

PWA mobile-first de novelas verticais brasileiras: streaming, progresso,
descoberta e comunidade. Esta é a **Fase 01** — o aplicativo do usuário final.
O painel administrativo é uma fase separada, mas os dados e eventos que ele vai
precisar já nascem aqui.

## Rodar localmente

```bash
npm install
cp .env.example .env      # preencha DATABASE_URL e SESSION_SECRET
npm run db:push           # cria o schema no Postgres
npm run db:seed           # catálogo de demonstração
npm run dev               # http://localhost:3100
```

Conta de demonstração: `demo@noveleiras.app` · senha `plantao123` — já vem com
progresso, lista e histórico para a Home nascer personalizada.

## Arquitetura

O produto se apoia em quatro costuras propositais, pensadas para que nada
precise ser refeito depois.

### 1. Camada de mídia substituível — `lib/media/resolver.ts`

Nenhuma parte do app conhece a URL de um vídeo. O banco guarda uma **chave
opaca** (`Episode.mediaKey`) e um provedor; o resolvedor é o único lugar que
transforma isso em algo tocável.

Migrar do computador de casa para uma CDN é trocar duas variáveis:

```bash
MEDIA_PROVIDER="CDN"
MEDIA_BASE_URL="https://cdn.exemplo.com/vod"
```

URLs assinadas (com expiração) entram dentro de `resolveMedia`, sem tocar em
nenhuma tela — o descritor `MediaSource` já carrega o campo `expiresAt`.

### 2. Acesso decidido no servidor — `lib/access/entitlements.ts`

A regra de quem pode assistir vive em um módulo só e é aplicada em
`/api/midia/[episodeId]`, **antes de a URL existir**. A interface mostra o
cadeado, mas quem impede é a rota. O plano gratuito libera os dois primeiros
episódios de cada novela premium; a integração com um provedor de pagamento
entra em `alternarPlano`, sem mexer no resto.

### 3. Telemetria como fundação do painel — `lib/analytics/track.ts`

Todo fato relevante cai num log append-only (`Event`), e o que precisa ser lido
em tempo real fica normalizado ao lado (`WatchProgress`, `AppSession`,
`SearchQuery`). Nenhuma tela escreve métrica agregada: registra o fato, o
agregado se deriva depois.

Já é possível responder, com os dados desta fase: usuários, sessões, tempo
dentro da plataforma, tempo assistido, progresso, novelas e episódios mais
acessados, buscas (e o que foi clicado nelas), favoritos, abandono, retenção,
engajamento no feed, dispositivos, assinaturas e catálogo.

### 4. Repositórios como fronteira de dados — `lib/repositories/`

Componentes não conhecem Prisma nem nomes de coluna. Trocar o catálogo de
demonstração por conteúdo real fica restrito a `data/catalog.ts` + seed.

## Estrutura

```
app/
  (app)/            telas com a casca do aplicativo (barra de abas)
  assistir/         player em tela cheia, fora da casca
  bem-vindo/        onboarding
  entrar/ criar-conta/
  api/              mídia, progresso, busca, telemetria, arte
components/
  novela/ player/ shell/ sistema/ ui/
lib/
  access/ actions/ analytics/ auth/ media/ repositories/
data/catalog.ts     catálogo de demonstração (única fonte fictícia)
prisma/             schema e seed
scripts/            inspeção visual, fluxo ponta a ponta, mídia, ícones
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento em `:3100` |
| `npm run build` | Build de produção |
| `npm test` | Testes de regra de negócio (Vitest) |
| `npm run typecheck` | TypeScript sem emitir |
| `npm run inspecionar` | Capturas de cada rota em 390×844 e erros de console |
| `npm run fluxo` | Percorre entrar → novela → player → progresso → busca |
| `npm run auditar` | PWA, acessibilidade prática e comportamento nativo |
| `npm run db:push` / `db:seed` / `db:studio` | Banco |
| `npm run midia:demo` | Gera os clipes de demonstração |
| `npm run icones` | Regera os PNGs do ícone a partir do SVG |

## Conteúdo

Todo o catálogo — novelas, episódios, elenco, comentários — é **ficção criada
para esta fase**, e o app diz isso em tela. As capas são desenhadas pelo próprio
produto (`lib/art.ts`) a partir do slug e da cor de cada obra; quando houver arte
real, basta a chave deixar de começar com `gen:`.

Os clipes em `public/media` (84 arquivos, ~11 MB) são cenas de demonstração
geradas por `npm run midia:demo`: a arte da novela, o título do episódio e um
relógio, o bastante para exercitar o player, a retomada e o tempo assistido de
verdade. Ficam versionados só para o app publicado ser assistível — no dia em
que `MEDIA_BASE_URL` apontar para a origem real, a pasta pode ser apagada.

## Infraestrutura

- **Vercel** — aplicação, deploy automático a cada push na `main`
- **Railway** — PostgreSQL
- Variáveis necessárias em produção: `DATABASE_URL`, `SESSION_SECRET`,
  `MEDIA_PROVIDER`, `MEDIA_BASE_URL`
