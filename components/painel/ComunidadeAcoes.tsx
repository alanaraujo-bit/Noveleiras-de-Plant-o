"use client";

import Link from "next/link";

import { AcaoProtegida } from "@/components/painel/AcaoProtegida";
import { Selo, Td } from "@/components/painel/primitivos";
import {
  alterarVisibilidadeDoComentario,
  alterarVisibilidadeDoPost,
  decidirDenuncia,
} from "@/lib/painel/acoes/comunidade";

/**
 * Controles de moderação.
 *
 * Cliente porque cada botão fecha sobre o seu próprio alvo, e função com
 * argumento fechado não atravessa a fronteira servidor→cliente. As ações
 * continuam no servidor e reconferem a permissão sozinhas — `podeModerar` aqui
 * só decide o que aparece, nunca o que é permitido.
 */

export function AcoesDoPost({
  postId,
  oculto,
  podeModerar,
}: {
  postId: string;
  oculto: boolean;
  podeModerar: boolean;
}) {
  if (!podeModerar) return null;

  return (
    <AcaoProtegida
      rotulo={oculto ? "Exibir" : "Ocultar"}
      titulo={oculto ? "Exibir esta publicação?" : "Ocultar esta publicação?"}
      descricao={
        oculto
          ? "A publicação volta a aparecer no aplicativo para todo mundo. O histórico de moderação permanece na auditoria."
          : "A publicação some do aplicativo, mas não é apagada: continua no banco e nesta tela, para que a decisão possa ser revisada."
      }
      confirmar={oculto ? "Exibir" : "Ocultar"}
      variante={oculto ? "sutil" : "perigo"}
      perigo={!oculto}
      pedirMotivo
      acao={(motivo) =>
        alterarVisibilidadeDoPost({ postId, ocultar: !oculto, motivo })
      }
    />
  );
}

export function AcoesDoComentario({
  comentarioId,
  oculto,
  podeModerar,
}: {
  comentarioId: string;
  oculto: boolean;
  podeModerar: boolean;
}) {
  if (!podeModerar) return null;

  return (
    <AcaoProtegida
      rotulo={oculto ? "Exibir" : "Ocultar"}
      titulo={oculto ? "Exibir este comentário?" : "Ocultar este comentário?"}
      descricao={
        oculto
          ? "O comentário volta a aparecer sob a publicação."
          : "O comentário some do aplicativo e continua no banco, disponível para revisão."
      }
      confirmar={oculto ? "Exibir" : "Ocultar"}
      variante={oculto ? "fantasma" : "perigo"}
      perigo={!oculto}
      pedirMotivo
      acao={(motivo) =>
        alterarVisibilidadeDoComentario({
          comentarioId,
          ocultar: !oculto,
          motivo,
        })
      }
    />
  );
}

export function AcoesDaDenuncia({
  denunciaId,
  estado,
  podeModerar,
}: {
  denunciaId: string;
  estado: string;
  podeModerar: boolean;
}) {
  if (!podeModerar) return null;

  const pendente = estado === "OPEN" || estado === "REVIEWING";

  if (!pendente) {
    return (
      <AcaoProtegida
        rotulo="Reabrir"
        titulo="Reabrir esta denúncia?"
        descricao="A denúncia volta para a fila e perde a marca de quem a decidiu e quando — reabrir é recomeçar a análise, não editar o desfecho anterior. A decisão original permanece na auditoria."
        confirmar="Reabrir"
        variante="fantasma"
        acao={(motivo) => decidirDenuncia({ denunciaId, estado: "OPEN", motivo })}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {estado === "OPEN" ? (
        <AcaoProtegida
          rotulo="Analisar"
          titulo="Marcar como em análise?"
          descricao="Sinaliza para o resto da equipe que alguém já está olhando esta denúncia. Não decide nada."
          confirmar="Marcar"
          variante="fantasma"
          acao={(motivo) =>
            decidirDenuncia({ denunciaId, estado: "REVIEWING", motivo })
          }
        />
      ) : null}
      <AcaoProtegida
        rotulo="Resolver"
        titulo="Resolver esta denúncia?"
        descricao="Use quando a denúncia procedia e a providência já foi tomada. Ocultar o conteúdo é uma ação separada — resolver aqui não esconde nada por conta própria."
        confirmar="Resolver"
        variante="sutil"
        pedirMotivo
        acao={(motivo) =>
          decidirDenuncia({ denunciaId, estado: "RESOLVED", motivo })
        }
      />
      <AcaoProtegida
        rotulo="Arquivar"
        titulo="Arquivar como improcedente?"
        descricao="Use quando a denúncia não procedia. O conteúdo continua como está e a denúncia sai da fila."
        confirmar="Arquivar"
        variante="fantasma"
        pedirMotivo
        acao={(motivo) =>
          decidirDenuncia({ denunciaId, estado: "DISMISSED", motivo })
        }
      />
    </div>
  );
}
