-- Separa venda de titulo de mensalidade no relatorio financeiro.
--
-- `Payment.plan` era nao-nulo com default PREMIUM, entao toda compra avulsa
-- entrava na receita como se fosse assinatura: o painel nao teria como separar
-- R$ 4,99 de novela de R$ 9,99 de plano.
--
-- Aditivo e seguro: as linhas existentes (nenhuma, hoje) ficam como
-- SUBSCRIPTION, que e o que elas de fato eram.
CREATE TYPE "PaymentKind" AS ENUM ('SUBSCRIPTION', 'TITLE_PURCHASE');

ALTER TABLE "Payment"
  ADD COLUMN "kind" "PaymentKind" NOT NULL DEFAULT 'SUBSCRIPTION',
  ALTER COLUMN "plan" DROP NOT NULL,
  ALTER COLUMN "plan" DROP DEFAULT;
