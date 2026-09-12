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

Restrições de dado: os gêneros vêm dos temas da origem (`lib/media/temas`), 14 no total, e só entram no filtro com ≥8 obras; as poucas novelas sem tema caem na leitura por texto (`belongsToGenre`). A legenda do cartão mostra o gênero mais específico da obra — a ordem de `GENEROS` é o que decide isso. "Em alta" é tendência dos últimos dias (`lib/repositories/tendencia`), e só quem tem tempo assistido recente ganha número de ranking. "Para você" só aparece quando o perfil de gosto passa de FORCA_MINIMA. Selo "Novo" foi removido da vitrine (todo o catálogo tem menos de 21 dias). Sem eyebrows nesta superfície.

Em aberto: página dedicada por tema; 23 pastas da biblioteca ainda fora do catálogo; o selo "Novo" em outras telas continua ruidoso.
