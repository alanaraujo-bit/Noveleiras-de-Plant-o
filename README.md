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

A regra de quem pode assistir vive em um módulo só e é aplicada **no servidor,
antes de a URL existir** — tanto na página de `/assistir` (que resolve a fonte e
a entrega pronta, para o player abrir tocando) quanto em `/api/midia`, que
continua sendo a autoridade e serve para renovar fontes que expiram. A interface
mostra o cadeado, mas quem impede é o servidor.

O plano gratuito libera os dois primeiros episódios de cada novela premium; a
integração com um provedor de pagamento entra em `alternarPlano`, sem mexer no
resto.

### 3. Telemetria como fundação do painel — `lib/analytics/track.ts`

Todo fato relevante cai num log append-only (`Event`), e o que precisa ser lido
em tempo real fica normalizado ao lado (`WatchProgress`, `AppSession`,
`SearchQuery`). Nenhuma tela escreve métrica agregada: registra o fato, o
agregado se deriva depois.

`npm run painel:previa` responde, com os dados já gravados, cada pergunta que o
painel vai fazer — é a prova de que ele não vai exigir migração. São elas: usuários, sessões, tempo
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
| `npm run painel:previa` | Responde, com os dados já gravados, cada pergunta do painel da Fase 02 |
| `npm run db:push` / `db:seed` / `db:studio` | Banco |
| `npm run midia:demo` | Gera os clipes de demonstração |
| `npm run icones` | Regera os PNGs do ícone a partir do SVG |
| `npm run painel:inspecionar` | Captura as 14 telas do painel em três larguras |
| `npm run painel:reconciliar` | Mostra (e com `--aplicar` corrige) contadores divergentes do catálogo |
| `npm run admin` | Concede e revoga acesso ao painel pela linha de comando |
| `npm run servidor` | Registra servidores de mídia e emite o segredo do agente |
| `npm run agente` | Roda o agente de batimentos na máquina que serve a mídia |
| `npm run agente:transcode` | Executa a fila de transcodificação nessa mesma máquina |
| `npm run midia:inventariar` | Varre os arquivos e escreve o inventário de mídia |
| `npm run painel:provar-moderacao` / `provar-acesso` / `provar-agente` | Exercitam ações e travas de ponta a ponta contra o banco |

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

## Servidor de mídia

O painel observa a máquina que guarda e serve os vídeos. Ela não precisa ser a
mesma que roda a aplicação — hoje pode ser um computador em casa, amanhã vários
nós, e a tela lista em vez de assumir um.

Registrar o servidor e receber o segredo (aparece **uma vez**; o banco guarda só
o hash):

```bash
npm run servidor -- registrar casa "PC da sala"
```

Na máquina que serve a mídia, guarde o que o comando imprimiu em `.env.agente`
e rode o agente:

```bash
node --env-file=.env.agente scripts/agente-midia.mjs
```

Ele manda um batimento por minuto — CPU, memória, disco, streams — e depende só
do Node: uma máquina que serve vídeo não deve precisar de ambiente de compilação
para ser observada. O que o Node não expõe (GPU) não é enviado, porque campo
ausente é mais honesto que zero inventado.

**Silêncio é informação.** A situação na tela vem de *quando* o último batimento
chegou, não do que ele afirmou: um agente que parou não deixa o servidor "no ar"
para sempre. Passados 90 segundos ele fica degradado; passados três minutos,
fora do ar.

### Transcodificação

O painel enfileira, o agente executa. A separação não é preferência: uma
função serverless vive minutos e transcodificar um episódio leva mais que
isso — e o arquivo de entrada está na máquina, não na nuvem.

Na tela de Mídia, o botão enfileira o lote que está listado (o filtro de
estado define o lote) num dos perfis: 720p, 480p ou HLS. Na máquina, rode o
executor ao lado do agente de batimentos:

```bash
node --env-file=.env.agente scripts/agente-transcode.mjs
```

Ele pega um trabalho por vez, roda o ffmpeg e reporta progresso, velocidade e
ETA. Cancelar no painel alcança um processo já em execução: o agente descobre
no próximo reporte e encerra. Trabalho preso em execução por mais de dez
minutos sem dar sinal volta para a fila sozinho — um agente que morreu não
pode bloquear a fila para sempre.

Os perfis vivem em código nos dois lados, duplicados de propósito: um agente
que aceitasse argumentos de ffmpeg vindos pela rede seria execução remota de
comando disfarçada de perfil.

### Alertas

Um alerta não é escrito à mão: é uma condição que passou a valer sobre fatos
que já estão no banco — servidor mudo, disco apertado, mídia prometida e
ausente, fila falhando, erro de reprodução acima do normal. A avaliação roda a
cada batimento — de minuto em minuto enquanto o agente estiver vivo — e uma vez
por dia pelo agendador, que cobre o caso em que o agente **parou** e ninguém
vai chamar nada. A cadência diária é limite do plano Hobby da Vercel; numa
conta Pro, troque o `schedule` em `vercel.json` para `*/10 * * * *` e a lacuna
some sem mudar código. Enquanto isso, um agente morto aparece imediatamente na
tela de Servidor, que deriva a situação do silêncio e não depende de alerta.

Três comportamentos que definem o motor: a deduplicação é por chave, então o
mesmo problema voltando soma ocorrências em vez de virar fila nova; o
fechamento é automático, porque alerta que só fecha na mão vira fila que
ninguém lê; e a reabertura preserva a história, já que "isso já aconteceu seis
vezes este mês" é a informação que resolve o caso.

Em produção é preciso definir `CRON_SECRET` — sem ela a rota de avaliação se
recusa a rodar, em vez de ficar aberta.

O inventário de arquivos é separado do batimento e roda sob demanda:

```bash
npm run midia:inventariar             # mostra o que faria
npm run midia:inventariar -- --aplicar
```

Ele varre a origem, lê duração, resolução e codec com o `ffmpeg`, calcula
checksum e escreve uma linha por arquivo. Três coisas que só a varredura revela:
arquivo prometido pelo catálogo e ausente do disco (`MISSING` — não some do
inventário, porque sumir esconderia o problema), arquivo órfão que ninguém usa,
e duplicata detectada por conteúdo em vez de por nome.

## Infraestrutura

- **Vercel** — aplicação. O deploy é **manual**: `npx vercel --prod`. Não há
  integração de Git ligada, então um push sozinho não publica nada.
- **Railway** — PostgreSQL
- Variáveis necessárias em produção: `DATABASE_URL`, `SESSION_SECRET`,
  `MEDIA_PROVIDER`, `MEDIA_BASE_URL`, `CRON_SECRET`
