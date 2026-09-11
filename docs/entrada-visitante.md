# Primeiro acesso ao Plantão

Abrir `/` leva ao `/plantao`. A visitante começa pelos capítulos gratuitos sem
cadastro. A regra compartilhada de acesso libera os cinco primeiros capítulos
e todas as obras com `openAccess`, inclusive para visitantes. Capítulos pagos
continuam protegidos no servidor. As URLs públicas autorizadas também são assinadas.

O botão “Salvar meu lugar” abre um convite contextual. Após aproximadamente
40 segundos de reprodução efetiva, aparece um lembrete dispensável, sem pausar
o vídeo. Esse lembrete automático respeita um intervalo de 24 horas por aparelho.
Curtidas, a ação de comentar e o limite gratuito apresentam explicações próprias.
A folha usa diálogo nativo, mantém o foco, fecha com Escape e respeita redução
de movimento. Abrir a folha pausa a novela; dispensá-la permite continuar.

Antes do cadastro, o último ponto de reprodução fica neste navegador por sete
dias. O episódio também é lembrado em cookie para preparar a próxima abertura
no servidor. Esse cookie nunca autoriza acesso. Após concluir um capítulo, a
próxima abertura busca sua continuação. A conta passa a salvar o progresso no
banco quando a reprodução continua autenticada.

Cadastro e login preservam o episódio em `destino`, validado no servidor.
Uma nova conta entra no plano gratuito e retorna ao episódio sem apresentação
obrigatória. O convite diferencia cadastro gratuito de assinatura ou compra.
O método disponível nesta implementação é e-mail e senha; Google não está configurado.

Verificação: `npm run typecheck`, `npm test` e, com o servidor local ativo,
`node scripts/provar-visitante.mjs`. O último verifica reprodução real, pausa,
dispensa e preservação do destino em celular e desktop, sem criar contas.
