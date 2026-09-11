-- Livro de ciclos da assinatura.
--
-- Uma cobranca real concede no maximo um ciclo (ja garantido por
-- Payment_provider_externalId_key) e um ciclo e pago por no maximo uma
-- cobranca (a unicidade nova abaixo). Colunas opcionais: compra avulsa,
-- cobranca recusada e pagamentos antigos continuam com as duas nulas.
--
-- Aditiva e compativel: nenhuma linha existente muda, e o Postgres permite
-- varios NULL numa unicidade composta.

ALTER TABLE "Payment" ADD COLUMN "cycleIndex" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "invoiceId" TEXT;

CREATE UNIQUE INDEX "Payment_subscriptionId_cycleIndex_key" ON "Payment"("subscriptionId", "cycleIndex");
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
