-- Entrega da arvore varrida em lotes.
--
-- A biblioteca de casa passou de 715 para 8899 arquivos, e a arvore inteira
-- num POST so bateu no teto de corpo da funcao: 413 FUNCTION_PAYLOAD_TOO_LARGE
-- em toda varredura. O agente passa a entregar em lotes de novelas.
--
-- Isso quebra a pergunta "o que sumiu do disco": ate aqui ela era "nao veio
-- neste envio", e com lotes o primeiro deles marcaria como ausente tudo o que
-- ainda estava por vir. `lastScanId` e o carimbo que devolve a pergunta ao seu
-- sentido — ausente e o que a varredura *inteira* nao viu, conferido depois do
-- ultimo lote.
--
-- Aditivo: as linhas existentes ficam com NULL, que a reconciliacao ja le como
-- "nao carimbado por esta varredura" — o mesmo que diria antes.
ALTER TABLE "MediaAsset" ADD COLUMN "lastScanId" TEXT;

-- A reconciliacao varre por servidor e nao havia indice nenhum para isso.
CREATE INDEX "MediaAsset_serverId_lastScanId_idx" ON "MediaAsset"("serverId", "lastScanId");

-- Quantas novelas a arvore trouxe. Era `dados.novelas.length` da requisicao
-- que fechava a varredura; em lotes essa requisicao so conhece o ultimo deles.
ALTER TABLE "LibraryScan" ADD COLUMN "novelasSeen" INTEGER NOT NULL DEFAULT 0;

-- Sinal de vida da varredura.
--
-- "Abandonada" era "comecou ha mais de 15 minutos", o que so servia enquanto a
-- entrega era uma requisicao unica logo apos a leitura do disco. Com dezenas de
-- lotes, uma varredura sadia cruza esse prazo trabalhando — e seria reciclada
-- no meio, deixando a biblioteca pela metade e sem reconciliacao.
ALTER TABLE "LibraryScan" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
