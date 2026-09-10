"use client";

import { useEffect, useState } from "react";

import { Folha } from "@/components/ui/Folha";
import { useToast } from "@/components/sistema/ToastProvider";
import { IconeCheck, IconeCompartilhar } from "@/components/ui/icones";
import { registrarEnvio } from "@/lib/actions/reel";
import type { LaminaReel } from "@/lib/repositories/reel";

/**
 * Enviar episódio.
 *
 * O caminho bom é a folha de compartilhamento do próprio sistema — ela conhece
 * os contatos, o WhatsApp e o histórico da pessoa, e nós não. A folha abaixo é
 * o plano B para navegadores sem `navigator.share`, e o plano B precisa
 * existir: no desktop, que é onde o app é testado, `share` frequentemente não
 * está disponível.
 *
 * O link aponta para a página da novela, não para `/assistir/[id]`, porque
 * aquela rota exige conta e mandaria quem recebeu direto para o formulário de
 * login. Um convite que abre num login não é um convite.
 */

export function FolhaEnviar({
  lamina,
  aoFechar,
  aoContar,
}: {
  lamina: LaminaReel;
  aoFechar: () => void;
  aoContar: (envios: number) => void;
}) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const [link, setLink] = useState("");

  const texto = `${lamina.novela.titulo} — T${lamina.episodio.temporada}, episódio ${lamina.episodio.numero}. Assiste comigo no Noveleiras de Plantão.`;

  useEffect(() => {
    setLink(
      `${window.location.origin}/novela/${lamina.novela.slug}?ep=${lamina.episodio.id}`,
    );
  }, [lamina.episodio.id, lamina.novela.slug]);

  // A folha do sistema é tentada assim que a folha abre: quando existe, a
  // pessoa nunca vê esta tela — vê a folha nativa, que é a que ela conhece.
  useEffect(() => {
    if (!link || typeof navigator.share !== "function") return;

    let cancelado = false;
    void navigator
      .share({ title: lamina.novela.titulo, text: texto, url: link })
      .then(() => {
        if (cancelado) return;
        contar();
        aoFechar();
      })
      .catch(() => {
        // Cancelar o envio é uma escolha legítima. A folha própria fica no
        // lugar, sem erro e sem cobrança.
      });

    return () => {
      cancelado = true;
    };
    // Uma tentativa por abertura: repetir a cada render abriria a folha do
    // sistema em laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  function contar() {
    void registrarEnvio(lamina.episodio.id)
      .then((resultado) => {
        if (resultado.ok) aoContar(resultado.envios);
      })
      .catch(() => {});
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`${texto}\n${link}`);
      setCopiado(true);
      contar();
      window.setTimeout(() => setCopiado(false), 2200);
    } catch {
      toast.show("Não deu para copiar o link.", "ruim");
    }
  }

  const destinos = [
    {
      nome: "WhatsApp",
      cor: "#25D366",
      url: `https://wa.me/?text=${encodeURIComponent(`${texto} ${link}`)}`,
    },
    {
      nome: "Telegram",
      cor: "#2AABEE",
      url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(texto)}`,
    },
    {
      nome: "X",
      cor: "#e8e8e8",
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(texto)}&url=${encodeURIComponent(link)}`,
    },
  ];

  return (
    <Folha aberta aoFechar={aoFechar} titulo="Enviar">
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 p-3">
        <img
          src={lamina.episodio.capaUrl}
          alt=""
          draggable={false}
          className="h-16 w-11 shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0">
          <p className="truncate font-display text-[0.9375rem] font-semibold text-cream-50">
            {lamina.novela.titulo}
          </p>
          <p className="truncate text-[0.75rem] text-cream-600">
            T{lamina.episodio.temporada} · Episódio {lamina.episodio.numero}
          </p>
        </div>
      </div>

      <ul className="mb-5 grid grid-cols-4 gap-3">
        {destinos.map((destino) => (
          <li key={destino.nome}>
            <a
              href={destino.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={contar}
              className="tap flex flex-col items-center gap-2"
            >
              <span
                aria-hidden
                className="grid size-12 place-items-center rounded-2xl text-ink-950"
                style={{ background: destino.cor }}
              >
                <IconeCompartilhar tamanho={20} />
              </span>
              <span className="text-[0.6875rem] font-semibold text-cream-400">
                {destino.nome}
              </span>
            </a>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={copiar}
            className="tap flex w-full flex-col items-center gap-2"
          >
            <span
              aria-hidden
              className="grid size-12 place-items-center rounded-2xl bg-white/10 text-cream-100"
            >
              {copiado ? <IconeCheck tamanho={20} /> : <IconeCompartilhar tamanho={20} />}
            </span>
            <span className="text-[0.6875rem] font-semibold text-cream-400">
              {copiado ? "Copiado" : "Copiar link"}
            </span>
          </button>
        </li>
      </ul>

      <p className="selectable truncate rounded-xl border border-white/8 bg-ink-900 px-3.5 py-3 text-[0.8125rem] text-cream-600">
        {link}
      </p>
    </Folha>
  );
}
