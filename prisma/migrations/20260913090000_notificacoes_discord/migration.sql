-- Notificações do painel para um canal do Discord. Só cria tabelas novas:
-- nenhuma linha existente muda, e o canal nasce desligado.

CREATE TABLE "DiscordConfig" (
    "id" TEXT NOT NULL DEFAULT 'principal',
    "webhookUrl" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "eventos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatorioAtivo" BOOLEAN NOT NULL DEFAULT false,
    "relatorioIntervalo" TEXT NOT NULL DEFAULT 'diario',
    "relatorioHora" INTEGER NOT NULL DEFAULT 8,
    "eventosDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscordEntrega" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ENVIANDO',
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "erro" TEXT,
    "resumo" TEXT,
    "teste" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),

    CONSTRAINT "DiscordEntrega_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscordEntrega_chave_key" ON "DiscordEntrega"("chave");
CREATE INDEX "DiscordEntrega_createdAt_idx" ON "DiscordEntrega"("createdAt");
CREATE INDEX "DiscordEntrega_estado_createdAt_idx" ON "DiscordEntrega"("estado", "createdAt");
