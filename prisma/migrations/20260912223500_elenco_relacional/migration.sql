-- Pessoas deixam de ser texto solto na ficha da novela. A coluna JSON
-- `Novela.cast` permanece como registro da origem; esta relação permite uma
-- página própria, foto, biografia e uma carreira com mais de uma obra.

CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "photoKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NovelaCast" (
    "novelaId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NovelaCast_pkey" PRIMARY KEY ("novelaId", "personId")
);

CREATE UNIQUE INDEX "Person_slug_key" ON "Person"("slug");
CREATE INDEX "Person_name_idx" ON "Person"("name");
CREATE INDEX "NovelaCast_personId_idx" ON "NovelaCast"("personId");

ALTER TABLE "NovelaCast"
  ADD CONSTRAINT "NovelaCast_novelaId_fkey"
  FOREIGN KEY ("novelaId") REFERENCES "Novela"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NovelaCast"
  ADD CONSTRAINT "NovelaCast_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
