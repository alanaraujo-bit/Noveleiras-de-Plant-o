-- Uma assinatura recorrente nasce de uma tentativa so e gera um pagamento por
-- ciclo. Com `attemptId` unico, a primeira renovacao violaria a constraint
-- dentro da transacao do webhook: 500 na resposta e reentrega em laco pelo
-- provedor. O indice fica; a unicidade sai.
DROP INDEX "Payment_attemptId_key";

CREATE INDEX "Payment_attemptId_idx" ON "Payment"("attemptId");
