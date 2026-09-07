---
name: "Noveleiras de Plantão — Painel"
description: "Sala de controle fria e escura para operar fatos do streaming sem abandonar o vinho, o carmim e o ouro do produto."
colors:
  control-room-bg: "#0f0a10"
  surface: "#17111a"
  elevated: "#1e1722"
  high-surface: "#261d2b"
  sidebar: "#130e16"
  line: "rgb(255 255 255 / 0.07)"
  line-strong: "rgb(255 255 255 / 0.14)"
  text: "#f4ecef"
  text-muted: "#b9a7b1"
  text-faint: "#8a7883"
  carmine: "#e03a69"
  carmine-button: "#c42a55"
  carmine-active: "#a01f45"
  rose-highlight: "#f2648c"
  rose-link: "#ff9ab3"
  success: "#4fc48f"
  attention-gold: "#e9bd78"
  danger: "#f5624d"
  info: "#6aa9e8"
  chart-carmine: "#e8517a"
  chart-neutral: "#6f5f6a"
  chart-blue: "#4a90d9"
  chart-orange: "#dd6f3d"
  chart-jade: "#2fa877"
typography:
  display:
    fontFamily: "var(--font-fraunces), Georgia, 'Times New Roman', serif"
    fontSize: "1.375rem"
    fontWeight: 600
    letterSpacing: "-0.018em"
    fontVariation: "'SOFT' 30, 'WONK' 1"
  title:
    fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    letterSpacing: "-0.011em"
  body:
    fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  label:
    fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.04em"
  number:
    fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    fontFeature: "'tnum' 1"
rounded:
  focus: "0.375rem"
  chip: "0.375rem"
  control: "0.5rem"
  panel: "0.75rem"
  surface: "1rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  2xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.carmine-button}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2rem"
  button-primary-hover:
    backgroundColor: "{colors.carmine}"
    textColor: "#ffffff"
  button-subtle:
    backgroundColor: "rgb(255 255 255 / 0.06)"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "{spacing.xl}"
  period-chip-selected:
    backgroundColor: "color-mix(in oklab, #e03a69 16%, transparent)"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.chip}"
    padding: "0.25rem 0.625rem"
---

# Design System: Noveleiras de Plantão — Painel

## Overview

**Creative North Star: "A Sala de Controle ao Lado do Teatro"**

Este documento governa a superfície administrativa marcada por `[data-superficie="painel"]`. O painel vive no mesmo mundo de Noveleiras de Plantão, mas muda a temperatura: a noite vinho fica mais fria e escura, o carmim vira sinal operacional e o ouro aparece como atenção, não ornamento. A sensação é de bastidor técnico ao lado do palco — sóbrio, preciso e inequivocamente parte do mesmo produto.

O modo é **Operate**. Densidade, comparação e rastreabilidade vêm antes da exibição; o ritmo visual nasce de cabeçalhos persistentes, superfícies tonais, gráficos SVG com leitura exata, livros-razão e tabelas que conduzem ao próximo nível. A hierarquia impede que cada número finja ter a mesma importância.

**Key Characteristics:**

- Superfície fria e escura, com identidade vinho/carmim/ouro preservada por detalhes raros.
- Alta densidade legível, números tabulares e texto operacional selecionável.
- Livro-razão para indicadores; cartões apenas para unidades reais de investigação.
- Gráficos SVG honestos, com grade recessiva, um eixo e leitura exata sob interação.
- Cabeçalho, período e caminho investigativo persistem enquanto a operação desce no detalhe.

## Colors

A base é uma escala de ameixa quase neutra; texto creme-frio sustenta a leitura, enquanto carmim e cores semânticas ficam reservados a estado, navegação e comparação.

### Primary

- **Carmim de operação:** marca seleção, foco, ação principal e a série solitária que representa o produto.
- **Carmim profundo:** sustenta o botão principal; clareia no hover e escurece no estado ativo.

### Secondary

- **Ouro de atenção:** sinaliza cobertura, cautela e situações que pedem leitura, nunca decoração.
- **Trio analítico:** azul, laranja e jade distinguem até três séries concorrentes; uma quarta categoria deve virar “outros” ou tabela.

### Tertiary

- **Verde factual, coral de perigo e azul de informação:** comunicam significado operacional e nunca substituem rótulo, ícone ou texto explicativo.

### Neutral

- **Fundo da sala de controle:** base contínua da aplicação administrativa.
- **Superfície, elevado e alto:** degraus tonais para cartões, hover, controles e elementos flutuantes.
- **Texto, suave e fraco:** três níveis estáveis de contraste para valor, apoio e metadado.
- **Linha e linha forte:** divisores discretos; a variante forte contorna controles ou superfícies flutuantes.
- **Neutro de comparação:** identifica o período anterior com traço descontínuo.

### Named Rules

**The Cor Is Evidence Rule.** Cor identifica série, estado ou ação; ela nunca preenche a tela para criar “energia”.

**The Error Is Not Carmine Rule.** Perigo permanece mais quente que o acento para que “selecionado” e “quebrado” não pareçam o mesmo estado.

## Typography

**Display Font:** Fraunces, com Georgia e Times New Roman como fallback.
**Body Font:** Manrope, com a pilha sans-serif do sistema como fallback.
**Label/Mono Font:** Manrope com algarismos tabulares; o painel não introduz uma fonte monoespaçada decorativa.

**Character:** Fraunces aparece somente como assinatura editorial no título da página. Todo rótulo, dado, controle e célula usa Manrope, mantendo a leitura firme, compacta e pouco performática.

### Hierarchy

- **Display** (600, 1.375rem): título de página; usa eixos `SOFT` e `WONK` para carregar a voz do produto sem contaminar os dados.
- **Title** (600, 0.9375rem): cabeçalhos de bloco e tabela, compactos e claramente superiores ao metadado.
- **Body** (400–500, 0.8125rem): navegação, células, controles e explicações operacionais.
- **Label** (600, 0.6875rem): cabeçalho de coluna, legenda, nota e metadado; caixa alta fica restrita aos nomes de grupo da navegação.
- **Number** (600, 1rem; 1.375rem no destaque): valores alinhados com `tabular-nums`, inclusive em tabela, horário e variação.

### Named Rules

**The Editorial Signature Rule.** Fraunces assina a página; Manrope executa todo o trabalho.

**The Numbers Must Not Dance Rule.** Valores comparáveis usam algarismos tabulares e alinhamento à direita.

## Layout

No desktop, uma lateral fixa de 15rem ancora a navegação e o conteúdo ocupa o restante da viewport. No toque, a mesma navegação vira gaveta de 17rem; o conjunto de destinos não muda. O cabeçalho da página permanece no topo com fundo translúcido e desfoque, preservando título, contexto e ações em tabelas longas.

O conteúdo usa respiro lateral de 1rem no celular e 1.5rem a partir do desktop. A cadência principal combina intervalos de 1.25rem entre unidades e preenchimento de 1.25rem em blocos; versões compactas usam 1rem. Na tela de streaming, o gráfico e o livro-razão ficam empilhados até `xl`, quando passam a uma grade com coluna analítica fixa de 21rem.

Controles temporais conservam largura intrínseca e rolam horizontalmente dentro do cabeçalho. Tabelas também mantêm rolagem horizontal visível. A curva temporal ocupa a largura disponível; no eixo do tempo, limita-se a quatro marcas abaixo de 480px e seis nas demais larguras.

**The Continuous Investigation Rule.** Período, breadcrumb e identidade do alvo sobrevivem a cada passo novela → temporada → episódio.

## Elevation & Depth

O sistema é tonal e plano por padrão. Fundo, superfície, elevado e alto criam profundidade por diferença de luminosidade e bordas translúcidas; cartões em repouso não recebem sombra. Sombras ficam reservadas a objetos que realmente flutuam sobre o plano, como balão de gráfico e seletor de data aberto.

### Shadow Vocabulary

- **Balão analítico** (`0 0.75rem 1.5rem -0.5rem rgb(0 0 0 / 0.6)`): separa a leitura exata do gráfico sem transformar o cartão inteiro em objeto elevado.
- **Popover temporal** (`0 1rem 2rem -0.75rem rgb(0 0 0 / 0.7)`): ancora o formulário de período personalizado acima do cabeçalho.
- **Cabeçalho de tabela:** usa apenas sombra interna de um pixel equivalente à linha divisória.

### Named Rules

**The Flat Until Floating Rule.** Superfícies em repouso usam tom e borda; sombra só aparece quando um elemento cruza planos.

## Shapes

O painel usa retângulos suavemente arredondados, nunca cápsulas indiscriminadas. Blocos investigativos têm raio de superfície; botões e navegação usam raio de controle; chips e selos são menores e mais contidos. Círculos aparecem apenas onde a semântica pede ponto de status, contador ou marcador de gráfico.

Bordas são hairlines translúcidas. O contorno forte pertence a controles que precisam separar-se do fundo e a superfícies flutuantes. Tabelas preservam a geometria retangular interna mesmo quando o contêiner externo é arredondado.

## Components

### Buttons

- **Shape:** controle compacto, suavemente arredondado, com altura de 2rem e alvo interno centralizado.
- **Primary:** fundo carmim profundo e texto branco; clareia no hover e volta ao tom mais escuro no ativo.
- **Hover / Focus:** mudança curta de cor e anel de foco carmim de 2px com deslocamento de 2px.
- **Secondary / Ghost / Danger:** o secundário usa branco translúcido e borda forte; o fantasma ganha fundo apenas na interação; o perigo combina coral translúcido, borda e texto do mesmo significado.
- **Disabled:** mantém a forma, reduz opacidade e bloqueia interação.

### Chips

- **Style:** selos usam raio pequeno, borda hairline e fundo semântico translúcido; texto permanece legível e nunca depende apenas da cor.
- **State:** o seletor de período é um controle segmentado rolável; apenas o intervalo pressionado recebe o banho carmim suave.

### Cards / Containers

- **Corner Style:** raio de superfície (1rem) e corte do conteúdo excedente.
- **Background:** superfície tonal sobre o fundo contínuo da sala de controle.
- **Shadow Strategy:** nenhuma em repouso; consultar Elevation & Depth para objetos flutuantes.
- **Border:** hairline neutra de baixo contraste.
- **Internal Padding:** 1.25rem no padrão e 1rem no compacto; o cabeçalho interno recebe divisor inferior.

### Inputs / Fields

- **Style:** superfície escura, linha discreta, raio de controle e texto operacional em Manrope.
- **Focus:** anel carmim global, visível por teclado.
- **Error / Disabled:** erro usa coral e texto explicativo; estado pendente reduz opacidade e anuncia atualização sem remover o contexto.

### Navigation

A lateral é persistente no desktop e gaveta no toque. O item ativo recebe fundo carmim muito suave, texto forte, ícone rosado e uma marca vertical fina à esquerda. Itens inativos usam texto suave e só clareiam no hover; grupos podem usar caixa alta porque funcionam como coordenadas, não como conteúdo.

### Livro-razão

Indicadores aparecem como extrato: rótulo e nota à esquerda, valor e variação alinhados à direita, separados por linhas discretas. O primeiro dado pode crescer para 1.375rem, mas os demais continuam compactos. Sem base comparável, a interface mostra “novo” ou travessão em vez de fabricar porcentagem.

### Tabelas investigativas

O cabeçalho de coluna é fixo; números ficam à direita, linhas têm alvo inteiro e hover tonal. A primeira coluna carrega o link e o contexto humano; a última ação explicita a descida. O contêiner deixa a barra de rolagem visível porque ela informa posição e conteúdo excedente.

### Gráficos SVG

Cada gráfico usa um único eixo, parte do zero e escolhe teto arredondado. A grade é recessiva, a série anterior é neutra e tracejada, e a cor do número permanece clara. O ponteiro revela valores exatos em balão; zero real e ausência de medição são explicados separadamente. Série única usa carmim; múltiplas usam no máximo o trio azul, laranja e jade.

## Do's and Don'ts

### Do:

- **Do** preserve o período na URL e em todos os links de drill-down.
- **Do** use livro-razão quando vários números formam uma leitura comparativa.
- **Do** mantenha texto, IDs, e-mails e mensagens selecionáveis dentro do painel.
- **Do** deixe barras de rolagem visíveis em tabelas e controles horizontais.
- **Do** associe cor semântica a rótulo, ícone ou explicação e respeite redução de movimento.
- **Do** declare cobertura parcial, inferência e ausência de base comparável no mesmo lugar do dado.

### Don't:

- **Don't** transforme o painel em uma grade uniforme de cartões de KPI.
- **Don't** use Fraunces em células, rótulos, controles ou números.
- **Don't** use preto puro, branco puro como superfície, gradiente decorativo ou arco-íris analítico.
- **Don't** use dois eixos, cortar o zero ou exibir mais de três séries cromáticas no mesmo gráfico.
- **Don't** esconda overflow de tabela ou reduza o seletor de período a estado local descartável.
- **Don't** confunda carmim de seleção com coral de erro, nem use só cor para comunicar estado.
