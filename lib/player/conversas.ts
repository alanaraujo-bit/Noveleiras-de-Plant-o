/**
 * Conversas já lidas nesta sessão, por episódio.
 *
 * Abrir e fechar os comentários do mesmo episódio três vezes não pode custar
 * três idas ao servidor — nem três esqueletos piscando. O painel abre na hora
 * com o que já foi lido e só busca o que ainda não conhece.
 *
 * Duas garantias:
 *
 * - **Uma busca por vez, por episódio.** Abrir, fechar e abrir de novo antes de
 *   a primeira resposta chegar reaproveita a mesma promessa em vez de disparar
 *   outra.
 * - **Falha não é guardada.** Um erro de rede vira estado de erro na tela e a
 *   próxima abertura tenta de novo; guardar a falha transformaria um soluço de
 *   conexão em "Ninguém comentou ainda" até recarregar o aplicativo.
 *
 * Validade curta: o bastante para ir e voltar sem nova busca, não o bastante
 * para esconder uma conversa que andou enquanto a pessoa assistia.
 */

export const VALIDADE_DA_CONVERSA_MS = 5 * 60_000;

type Guardada = { itens: unknown[]; em: number };

const guardadas = new Map<string, Guardada>();
const emVoo = new Map<string, Promise<unknown[]>>();

/** A conversa guardada, se ainda válida. */
export function conversaGuardada<T>(
  episodioId: string,
  agora: number = Date.now(),
): T[] | null {
  const guardada = guardadas.get(episodioId);
  if (!guardada) return null;
  if (agora - guardada.em > VALIDADE_DA_CONVERSA_MS) {
    guardadas.delete(episodioId);
    return null;
  }
  return guardada.itens as T[];
}

/**
 * A conversa do episódio: da memória quando possível, do servidor quando não.
 *
 * `carregar` é injetado para que a regra — memória, promessa compartilhada,
 * falha sem guardar — seja testável sem servidor.
 */
export function buscarConversa<T>(
  episodioId: string,
  carregar: (episodioId: string) => Promise<T[]>,
  agora: number = Date.now(),
): Promise<T[]> {
  const guardada = conversaGuardada<T>(episodioId, agora);
  if (guardada) return Promise.resolve(guardada);

  const pendente = emVoo.get(episodioId);
  if (pendente) return pendente as Promise<T[]>;

  const promessa = carregar(episodioId)
    .then((itens) => {
      guardadas.set(episodioId, { itens, em: Date.now() });
      return itens;
    })
    .finally(() => {
      emVoo.delete(episodioId);
    });

  emVoo.set(episodioId, promessa as Promise<unknown[]>);
  return promessa;
}

/**
 * Mantém a memória coerente com o que a pessoa acabou de fazer — publicar,
 * apagar, curtir. Sem isto, fechar e reabrir mostraria a conversa de antes do
 * próprio comentário dela.
 */
export function atualizarConversa<T>(
  episodioId: string,
  muda: (itens: T[]) => T[],
): void {
  const guardada = guardadas.get(episodioId);
  if (!guardada) return;
  guardadas.set(episodioId, {
    itens: muda(guardada.itens as T[]),
    em: guardada.em,
  });
}

/** Só para teste. */
export function esquecerConversas(): void {
  guardadas.clear();
  emVoo.clear();
}
