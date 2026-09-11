# Mercado Pago — o que falta para ligar

A integração está escrita e testada. Falta apenas preencher credenciais: nada
no código precisa mudar para produção entrar no ar.

Enquanto as variáveis não existirem, o aplicativo sobe, navega e compila
normalmente — só o botão de pagar responde `503` com a lista do que falta.

---

## 1. Variáveis que você precisa fornecer

Cadastre em **Vercel → Project → Settings → Environment Variables**, no
ambiente **Production** (e, se quiser testar em preview, também em Preview com
as credenciais de teste).

| Variável | Obrigatória | Onde encontrar |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | **sim** | Painel do Mercado Pago → Suas integrações → sua aplicação → Credenciais de produção → *Access token*. Começa com `APP_USR-`. |
| `MERCADOPAGO_WEBHOOK_SECRET` | **sim** | Painel → sua aplicação → Webhooks → *Assinatura secreta*. Gerada no momento em que você cadastra a URL de notificação. |
| `MERCADOPAGO_NOTIFICATION_URL` | recomendada | A URL pública do webhook (seção 3). Sem ela, o Mercado Pago usa a URL configurada no painel; com ela, cada cobrança carrega o endereço explicitamente — o que evita perder notificação se o painel for alterado. |
| `MERCADOPAGO_TEST_PAYER_EMAIL` | só em teste | E-mail de um **Buyer Test User** criado no painel (Suas integrações → Contas de teste). Enquanto as credenciais forem de um usuário de teste, é este e-mail que vai no corpo enviado ao provedor — a conta real de quem clicou continua sendo a dona da tentativa, da compra e do direito. Ver seção 9. |
| `MERCADOPAGO_PUBLIC_KEY` | **não** | Só seria necessária para montar o formulário de cartão dentro do nosso domínio (Checkout Transparente). A implementação atual usa checkout hospedado e Pix, que não expõem dados de cartão para nós — e é justamente por isso que ela não pede PCI. Se um dia quiser o formulário embutido, é esta a chave que entra. |

### Variáveis nossas, que eu não consigo gravar

Estas não vêm do Mercado Pago, mas precisam existir em produção:

| Variável | Para quê |
|---|---|
| `MEDIA_SIGNING_SECRET` | Assina as URLs de vídeo com prazo. Precisa ser **o mesmo valor** no app (Vercel) e no servidor de mídia (`.env.agente`, na máquina do disco). Gere com `openssl rand -hex 32`. Enquanto estiver vazio nos dois lados, o vídeo é servido sem assinatura — que é o comportamento de desenvolvimento. |
| `CRON_SECRET` | Já existe. O cron de expiração de assinaturas usa o mesmo. |

### E uma que **não** pode existir em produção

`PAGAMENTOS_MOCK` — o provedor falso. Se ela aparecer com `VERCEL_ENV=production`,
a aplicação **falha ao iniciar o pagamento**, de propósito: passar batido
significaria liberar o catálogo inteiro sem cobrar. Mantenha-a apenas em
`.env.development.local`.

---

## 2. Como configurar do lado do Mercado Pago

1. **Criar a aplicação**: Painel → Suas integrações → Criar aplicação.
   Modelo de negócio: *Assinaturas* + *Pagamentos online*.
2. **Ativar assinaturas recorrentes** (`preapproval`). Sem isso, o plano
   mensal e o anual não podem ser criados — só as compras avulsas funcionam.
3. **Cadastrar o webhook** (seção 3), marcando os tópicos da seção 4.
4. **Copiar a assinatura secreta** que aparece ao salvar o webhook — é o
   `MERCADOPAGO_WEBHOOK_SECRET`. Ela só é exibida uma vez.

---

## 3. URL do webhook

O endpoint é uma rota da aplicação, no mesmo deploy do app:

```
<origem>/api/pagamentos/webhook
```

Publicada e verificada externamente:

```
https://noveleiras-de-plantao.vercel.app/api/pagamentos/webhook
```

É ela que vai nos dois lugares: no cadastro de webhook do painel do Mercado
Pago e em `MERCADOPAGO_NOTIFICATION_URL`.

Na `notification_url` enviada em pagamentos, preferências e preapprovals, o
app acrescenta `source_news=webhooks` (preservando os parâmetros que já
existirem). É isso que pede ao Mercado Pago o formato **Webhook** assinado, e
não o IPN legado.

Teste (credenciais de teste) e produção usam **a mesma rota**; o que muda é o
par de credenciais e, se você usar um preview, o domínio.

Para conferir que o endereço responde antes de cadastrá-lo, um `GET` na URL
devolve `{"ok":true}` — é o que o Mercado Pago usa para validar o endpoint.

---

## 4. Tópicos que esta rota processa

Marque estes ao cadastrar o webhook:

| Tópico | O que fazemos |
|---|---|
| `payment` | Reconsulta `/v1/payments/{id}` e concilia: aprova, recusa, reembolsa ou registra chargeback. |
| `merchant_order` | Mesma reconciliação, para o fluxo do Checkout Pro. |
| `subscription_authorized_payment` | Cobrança de um ciclo da recorrência. Vai pelo caminho de **pagamento**, não de assinatura — o `data.id` aqui é de uma cobrança, não do `preapproval`. |
| `preapproval` | Assinatura autorizada, pausada ou cancelada. |
| `subscription_preapproval` | Mesmo recurso, nome alternativo. |

Qualquer outro tópico é gravado como `IGNORED` e responde `200` — recusar o
desconhecido só provocaria reentrega infinita.

---

## 5. O que a rota garante

- **Webhook e IPN legado são separados pela forma.** Webhook = corpo com
  `type`/`data.id`, exige `x-signature` e `x-request-id`, e só é processado
  com HMAC válida. IPN = `?topic=…&id=…` ou corpo `{topic, resource}`: não
  passa pela HMAC, é gravado com `format = IPN`, `status = IGNORED`, responde
  `200` e **não altera** Payment, Subscription, Entitlement nem Purchase.
- **Assinatura HMAC conferida** no formato deles
  (`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`), com comparação em tempo
  constante. Webhook forjado responde `401` **e fica gravado** — tentativa de
  fraude é o que mais interessa auditar depois.
- **Tentativa não validada nunca ocupa a chave de idempotência.** Assinatura
  inválida e IPN gravam `eventId` sintético (`rejeitado:…` / `ipn:…`) e o id
  alegado em `claimedEventId`. Cada tentativa é uma linha, e nenhuma bloqueia
  a reentrega válida do mesmo evento.
- **Idempotência pelo banco** para evento validado: `WebhookEvent` tem única
  em `(provider, eventId)`. Reentrega de evento `PROCESSED`/`IGNORED` esbarra
  na constraint antes de qualquer efeito; uma `FAILED` (erro nosso) é
  reivindicada e reprocessada por atualização condicional — duas reentregas
  simultâneas não processam duas vezes.
- **Diagnóstico sem segredo** em `WebhookEvent.diagnostics`: `formato`,
  `hasXSignature`, `hasXRequestId`, `signatureHasTs`, `signatureHasV1`,
  `dataIdSource` e `liveMode`. Nunca o valor de `x-signature`, `v1`, segredo
  ou token.
- **O corpo do webhook nunca autoriza nada.** Ele só diz que algo mudou; quem
  decide é a releitura autenticada do recurso no provedor.
- **Erro nosso responde `500`**, de propósito, para provocar reentrega — que é
  segura justamente por causa da idempotência.

---

## 6. Depois de preencher as credenciais

```bash
# 1. Conferir que os planos existem no banco de produção
node --env-file=.env.production scripts/semear-planos.ts

# 2. Fazer uma compra de teste com as credenciais de teste
#    (usuário de teste do Mercado Pago, cartão de teste)

# 3. Conferir que o webhook chegou e foi processado
```

O webhook processado aparece em `WebhookEvent` com `status = PROCESSED` e o
`providerSnapshot` preenchido com o que o Mercado Pago respondeu na
reconsulta. Se aparecer `FAILED`, o campo `error` diz o motivo e a coluna
`attempts` mostra quantas reentregas houve.

---

## 7. Preços em vigor

Definidos em `lib/pagamentos/planos.ts` e espelhados na tabela `Plan`:

| Produto | Preço | Direito |
|---|---|---|
| Gratuito | R$ 0,00 | 5 primeiros episódios de **cada** novela |
| Mensal | R$ 9,99/mês | Catálogo inteiro enquanto ativo |
| Anual | R$ 99,90/ano | Catálogo inteiro por 12 meses |
| Avulso | R$ 4,99 | Uma novela, permanente, incluindo episódios futuros |

Mudar preço é mudar o código (revisão obrigatória) e rodar
`scripts/semear-planos.ts`. Vendas já feitas guardam o preço da época em
`Payment.amountCents` — a tabela nova não reescreve o passado.

---

## 8. Pix e cartão

- **Compra avulsa**: cartão (Checkout Pro) ou Pix. O Pix devolve copia-e-cola
  e a tela vira sozinha quando o banco confirma.
- **Assinatura**: **cartão apenas**. O Mercado Pago não faz débito automático
  por Pix, então uma assinatura por Pix nunca renovaria. A tentativa é
  recusada com mensagem clara em vez de criar algo quebrado.

---

## 9. Comprador de teste (`MERCADOPAGO_TEST_PAYER_EMAIL`)

### Por que existe

O Mercado Pago recusa cobranças em que pagador e recebedor são de naturezas
diferentes:

```
HTTP 400
{ "message": "Both payer and collector must be real or test users", "status": 400 }
```

Enquanto a operação roda com credenciais de um **usuário de teste**, o
`payer_email` também precisa ser de um usuário de teste. Mandar o e-mail real
de quem clicou — que é o correto em produção — derruba todo checkout com esse
400.

### O que a variável muda, e o que ela não muda

Muda **apenas** o `payer_email` no corpo enviado ao Mercado Pago.

Não muda nada nosso: `PaymentAttempt.userId`, `Purchase.userId` e o
`Entitlement` continuam apontando para a conta real de quem clicou. Quem paga
com o comprador de teste é quem recebe o acesso. A conta da pessoa não é
alterada, e o e-mail nunca é enviado ao frontend.

### As duas travas

A substituição exige **as duas** condições ao mesmo tempo:

1. `MERCADOPAGO_TEST_PAYER_EMAIL` configurada;
2. a conta dona do access token confirmada como usuário de teste.

A segunda é verificada em tempo de execução: prefixo `TEST-` no token, ou a
tag `test_user` em `GET /users/me` — este último é o único sinal confiável,
porque credenciais de usuário de teste vêm com o mesmo prefixo `APP_USR-` das
de produção.

**Falha fechada.** Se a consulta não responder, o sistema assume produção e
usa o e-mail real. O erro seguro é o checkout falhar visivelmente num ambiente
de teste; o inseguro seria cobrar um comprador de teste achando que é
produção.

### Ao migrar para produção real

Não é preciso fazer nada. Trocando as credenciais, a conta deixa de ter a tag
`test_user`, a segunda condição para de valer e o `payer_email` volta
sozinho a ser o e-mail real — mesmo que a variável fique para trás. Nesse
caso ela é ignorada e um aviso vai ao log do servidor pedindo a remoção.

A memória do tipo de conta dura 10 minutos, então a virada acontece sem
reinício.

### Efeito no relatório financeiro

Cobrança feita contra um comprador de teste nasce com `isDemo: true` — o mesmo
campo que o painel já usa para separar receita real de vitrine. Sem isso,
dinheiro fictício entraria no MRR.
