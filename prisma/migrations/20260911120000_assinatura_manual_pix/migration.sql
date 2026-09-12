-- Plano mensal pago por Pix: cada ciclo nasce de um pagamento feito a mao.
--
-- Aditiva por inteiro. Nenhuma linha existente muda de comportamento: toda
-- assinatura gravada ate aqui renova sozinha no cartao, que e exatamente o
-- default da coluna nova. As colunas de `Payment` e `PaymentAttempt` nascem
-- nulas — cobranca antiga nao ganha rotulo retroativo que ninguem conferiu.

-- Como um ciclo vira o proximo. Nao e o meio de pagamento: meio de pagamento
-- ja mora em "method". Aqui esta quem tem a iniciativa da renovacao.
CREATE TYPE "BillingMode" AS ENUM ('AUTO_RENEW', 'MANUAL_RENEW');

ALTER TABLE "Subscription"
  ADD COLUMN "billingMode" "BillingMode" NOT NULL DEFAULT 'AUTO_RENEW';

-- Nulo de proposito em compra avulsa e nas cobrancas anteriores a esta fase.
ALTER TABLE "Payment" ADD COLUMN "billingMode" "BillingMode";

-- Em "kind = SUBSCRIPTION", e o que decide para onde a reconciliacao manda o
-- pagamento: AUTO_RENEW guarda o preapproval em "externalId" e o ciclo sai do
-- livro de faturas; MANUAL_RENEW guarda o proprio pagamento, e o ciclo sai
-- dele. Trocar os dois caminhos devolve 404 no provedor.
ALTER TABLE "PaymentAttempt" ADD COLUMN "billingMode" "BillingMode";

-- O PNG do QR fica gravado para quem fecha o aplicativo e volta depois
-- reencontrar a mesma cobranca, em vez de abrir uma segunda.
ALTER TABLE "PaymentAttempt" ADD COLUMN "pixQrCodeBase64" TEXT;

-- "Quem renova a mao e esta perto de vencer?" e a pergunta do cron do Pix.
CREATE INDEX "Subscription_billingMode_status_currentPeriodEnd_idx"
  ON "Subscription"("billingMode", "status", "currentPeriodEnd");

-- E a varredura de cobranca sem desfecho parte daqui.
CREATE INDEX "PaymentAttempt_kind_billingMode_status_createdAt_idx"
  ON "PaymentAttempt"("kind", "billingMode", "status", "createdAt");
