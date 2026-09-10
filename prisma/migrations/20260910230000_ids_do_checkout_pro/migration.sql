-- Separa os tres ids do Checkout Pro que antes disputavam a coluna `externalId`.
--
-- `externalId` passa a significar so o recurso que decide o estado: o pagamento
-- numa compra, o preapproval numa assinatura. Preferencia e merchant order
-- ganham coluna propria, porque consultar /v1/payments/<preferenceId> devolve
-- 404 e a reconciliacao falhava em silencio.

ALTER TABLE "PaymentAttempt" ADD COLUMN "externalPreferenceId" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "externalMerchantOrderId" TEXT;

CREATE INDEX "PaymentAttempt_externalPreferenceId_idx" ON "PaymentAttempt"("externalPreferenceId");
CREATE INDEX "PaymentAttempt_externalMerchantOrderId_idx" ON "PaymentAttempt"("externalMerchantOrderId");
