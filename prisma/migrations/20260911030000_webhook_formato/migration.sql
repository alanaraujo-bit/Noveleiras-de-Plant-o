-- Webhook moderno x IPN legado, e tentativa nao validada fora da chave de
-- idempotencia.
ALTER TABLE "WebhookEvent"
  ADD COLUMN "format" TEXT,
  ADD COLUMN "claimedEventId" TEXT,
  ADD COLUMN "diagnostics" JSONB;

-- Linhas gravadas antes desta separacao: a tentativa recusada ocupava o id
-- real do evento e barraria a reentrega valida dele. Sai do caminho, e o id
-- que ela alegava fica preservado em "claimedEventId".
UPDATE "WebhookEvent"
   SET "claimedEventId" = "eventId",
       "eventId" = 'rejeitado:' || "id"
 WHERE "signatureValid" = false;

CREATE INDEX "WebhookEvent_claimedEventId_idx" ON "WebhookEvent"("claimedEventId");
