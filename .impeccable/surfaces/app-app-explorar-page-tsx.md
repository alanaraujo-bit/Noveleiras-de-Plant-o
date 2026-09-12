---
version: 1
slug: "app-app-explorar-page-tsx"
primary_target: "app/(app)/explorar/page.tsx"
related_targets: ["app/(app)/explorar/Vitrine.tsx"]
---

Escopo: /explorar (antes /inicio + /buscar). Modo: Operate — achar a próxima novela.

Público e tarefa: espectadoras no celular que saíram do Plantão (reel) procurando algo específico ou querendo escolher por critério. Tarefa: buscar pelo nome/tema/elenco, ver o que está em alta, filtrar por tema, retomar com um toque.

Direção escolhida: "Vitrine com filtros" — uma grade única de duas colunas reordenada por uma barra de filtros fixa (Em alta · Para você · Novidades · Curtinhas | temas). A busca vive no topo da mesma tela; a aba Buscar deixou de existir e a vaga foi para Minha lista.

Momento memorável: trocar de filtro e ver a grade se rearranjar — capas que ficam deslizam (layout spring), as que saem desfocam, as novas sobem em cascata; a pílula ativa desliza entre os filtros.

Restrições de dado: gêneros/tags estão vazios no banco; temas vêm da inferência por texto (`belongsToGenre`) e só aparecem com ≥8 obras. "Para você" só aparece quando o perfil de gosto passa de FORCA_MINIMA. Selo "Novo" foi removido da vitrine (todo o catálogo tem menos de 21 dias). Sem eyebrows nesta superfície.

Em aberto: arte de gênero (`/api/arte/genero/*` responde 404); página dedicada por tema; o selo "Novo" em outras telas continua ruidoso.
