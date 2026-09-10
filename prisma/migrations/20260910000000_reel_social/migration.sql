-- Reel: social do episodio.
--
-- Puramente aditiva. Nenhuma coluna, tabela ou valor de enum e removido, e
-- todas as colunas novas de Episode tem valor padrao — linhas gravadas
-- continuam validas sem reescrita.
--
-- Os contadores likeCount/commentCount/shareCount comecam em zero por
-- construcao, e nao por estimativa: nao existe curtida anterior a esta
-- migracao para recuperar.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'REEL_OPEN';
ALTER TYPE "EventType" ADD VALUE 'REEL_SLIDE_VIEW';
ALTER TYPE "EventType" ADD VALUE 'REEL_SLIDE_SKIP';
ALTER TYPE "EventType" ADD VALUE 'EPISODE_LIKE';
ALTER TYPE "EventType" ADD VALUE 'EPISODE_UNLIKE';
ALTER TYPE "EventType" ADD VALUE 'EPISODE_COMMENT';
ALTER TYPE "EventType" ADD VALUE 'EPISODE_SHARE';

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE 'EPISODE_COMMENT';

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hookText" TEXT,
ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shareCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EpisodeLike" (
    "episodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeLike_pkey" PRIMARY KEY ("episodeId","userId")
);

-- CreateTable
CREATE TABLE "EpisodeComment" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "EpisodeComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EpisodeLike_userId_createdAt_idx" ON "EpisodeLike"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EpisodeComment_episodeId_hiddenAt_createdAt_idx" ON "EpisodeComment"("episodeId", "hiddenAt", "createdAt");

-- CreateIndex
CREATE INDEX "EpisodeComment_userId_createdAt_idx" ON "EpisodeComment"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EpisodeLike" ADD CONSTRAINT "EpisodeLike_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeLike" ADD CONSTRAINT "EpisodeLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeComment" ADD CONSTRAINT "EpisodeComment_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeComment" ADD CONSTRAINT "EpisodeComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

