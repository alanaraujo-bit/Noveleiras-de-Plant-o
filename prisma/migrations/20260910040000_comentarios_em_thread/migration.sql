-- Comentarios em thread: resposta e curtida de comentario.
--
-- Aditiva. Nenhuma coluna ou tabela removida. As duas chaves novas de
-- EpisodeComment sao anulaveis, entao as linhas ja gravadas viram raizes de
-- conversa sem reescrita.

-- DropIndex
DROP INDEX "EpisodeComment_episodeId_hiddenAt_createdAt_idx";

-- AlterTable
ALTER TABLE "EpisodeComment" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "replyToId" TEXT;

-- CreateTable
CREATE TABLE "EpisodeCommentLike" (
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeCommentLike_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateIndex
CREATE INDEX "EpisodeCommentLike_userId_createdAt_idx" ON "EpisodeCommentLike"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EpisodeComment_episodeId_parentId_hiddenAt_createdAt_idx" ON "EpisodeComment"("episodeId", "parentId", "hiddenAt", "createdAt");

-- CreateIndex
CREATE INDEX "EpisodeComment_parentId_createdAt_idx" ON "EpisodeComment"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "EpisodeComment" ADD CONSTRAINT "EpisodeComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EpisodeComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeComment" ADD CONSTRAINT "EpisodeComment_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "EpisodeComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeCommentLike" ADD CONSTRAINT "EpisodeCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "EpisodeComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeCommentLike" ADD CONSTRAINT "EpisodeCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

