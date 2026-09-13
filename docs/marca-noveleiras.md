# Marca Noveleiras

O nome do aplicativo é **Noveleiras**. **Plantão** permanece o nome da experiência de vídeo e de seu atalho em `/plantao`.

## Conceito aprovado

A marca aprovada é a **flor de conversa**: uma flor cuja silhueta também lembra um balão de conversa, com uma pequena ponta integrada à pétala inferior. Pétalas arredondadas em rosa e coral envolvem um centro pêssego. O relevo 3D suave, o acabamento acetinado e as formas acolhedoras dão à marca uma expressão feminina e amigável, associando romance e conversa de fãs.

A flor foi gerada com a ferramenta de imagem integrada. `public/marca/prompt.txt` preserva o prompt exato e `public/marca/noveleiras-original.png` contém o original aprovado usado pelo exportador. O PNG versionado é a fonte para reproduzir as exportações; uma nova geração pode produzir outra imagem.

## Arquivos e aplicações

| Arquivo | Uso |
| --- | --- |
| `public/marca/noveleiras-original.png` | Original da marca usado pelo exportador |
| `public/marca/prompt.txt` | Prompt de geração |
| `public/marca/noveleiras-simbolo.webp` | Símbolo transparente de 256 × 256px usado por `IconeMarca` |
| `public/icones/noveleiras-192.png` | Ícone PWA de 192 × 192px |
| `public/icones/noveleiras-512.png` | Ícone PWA de 512 × 512px |
| `public/icones/noveleiras-maskable-512.png` | Variante maskable de 512 × 512px; original redimensionado a 76% do lado |
| `public/icones/noveleiras-apple-180.png` | Ícone Apple de 180 × 180px |
| `public/icones/noveleiras-32.png` | Favicon PNG de 32 × 32px |
| `app/favicon.ico` | ICO com imagens de 16, 32 e 48px |

Os PNGs de instalação e favicon são compostos sobre vinho `#21101b`. As variantes regulares, Apple e PNG de 32px centralizam o original redimensionado a 90% do lado da tela de saída; a variante maskable usa 76% para reservar margem de recorte. O WebP mantém transparência para a aplicação sobre as superfícies existentes. A paleta quente do aplicativo foi preservada; o fundo da marca não substitui as cores de tema do manifest nem os tokens administrativos de `DESIGN.md`.

`IconeMarca`, em `components/ui/icones.tsx`, usa o WebP dentro de um SVG decorativo, no enquadramento natural de 32 × 32 unidades, sem ampliar ou recortar a imagem. Quando a marca funciona como link ou botão, o elemento interativo fornece o nome acessível. Usar o mesmo ativo de flor em todas as aplicações da marca.

## Exportação

Na raiz do projeto, com as dependências instaladas:

```sh
npm run icones
```

O comando executa `scripts/gerar-icones.mjs`, que utiliza Sharp para gerar os PNGs, o WebP e o ICO a partir do original. Ele também atualiza os nomes de compatibilidade `icone-192.png`, `icone-512.png`, `icone-mascara-512.png`, `apple-touch-icon.png` e `icone.svg`; este último incorpora o PNG e não é uma versão vetorial do desenho.

`public/manifest.webmanifest` define `name` e `short_name` como Noveleiras e referencia os ícones PWA. `app/layout.tsx` usa o mesmo nome em metadados, título Apple e Open Graph, com os favicons e o ícone Apple exportados. As referências aos PNGs e ao WebP usam `?v=flor-1`. `public/sw.js` usa a versão `v4-noveleiras-flor` e inclui esses mesmos endereços no pré-cache.

## Revisão registrada

A revisão final da flor aprovada considerou `.impeccable/review/marca.png`, `.impeccable/review/mobile.png` e `.impeccable/review/desktop.png`, com parecer favorável para a entrega da marca e suas aplicações. A medição da silhueta maskable encontrou raio máximo de 179,8px, dentro do raio seguro de 204,8px na imagem de 512px.

A checagem de tipos e as verificações de metadados, respostas HTTP dos ativos e pré-cache passaram. O build de produção (`node node_modules/next/dist/bin/next build`) também passou, incluindo compilação, TypeScript e geração de 23 páginas estáticas. Não houve teste em aparelhos físicos; as capturas e medições não comprovam instalação e apresentação pelos sistemas operacionais em dispositivos reais.

Esta entrega documenta a identidade e suas aplicações existentes. As regras do painel continuam em `DESIGN.md`; fatos de produto continuam em `PRODUCT.md`.
