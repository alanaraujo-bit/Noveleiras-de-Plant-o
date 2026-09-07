"use client";

import { useState, useTransition } from "react";

import {
  salvarGenerosPreferidos,
  salvarPerfil,
  salvarPreferencias,
} from "@/lib/actions/conta";
import { useToast } from "@/components/sistema/ToastProvider";
import { Avatar, Chip } from "@/components/ui/primitivos";

/**
 * Preferências.
 *
 * Cada mudança salva sozinha e avisa — sem botão “Salvar” escondido no fim da
 * página, que é onde ajustes de app costumam se perder.
 */

type Preferencias = {
  autoplayNext: boolean;
  dataSaver: boolean;
  reduceMotion: boolean;
  spoilerGuard: boolean;
  notifyReleases: boolean;
  notifyCommunity: boolean;
  preferredQuality: string;
  favoriteGenreIds: string[];
};

const QUALIDADES = [
  { valor: "auto", rotulo: "Automática" },
  { valor: "alta", rotulo: "Alta" },
  { valor: "economia", rotulo: "Economia" },
] as const;

const INTERRUPTORES = [
  {
    chave: "autoplayNext",
    titulo: "Tocar o próximo automaticamente",
    descricao: "Emenda no episódio seguinte quando o atual termina.",
  },
  {
    chave: "spoilerGuard",
    titulo: "Proteção contra spoiler",
    descricao: "Embaça comentários marcados até você tocar para ler.",
  },
  {
    chave: "dataSaver",
    titulo: "Economia de dados",
    descricao: "Prioriza qualidade menor fora do Wi-Fi.",
  },
  {
    chave: "reduceMotion",
    titulo: "Reduzir animações",
    descricao: "Deixa transições e movimentos mais discretos.",
  },
  {
    chave: "notifyReleases",
    titulo: "Avisar sobre episódios novos",
    descricao: "Das novelas que você acompanha.",
  },
  {
    chave: "notifyCommunity",
    titulo: "Avisar sobre respostas",
    descricao: "Quando alguém comenta as suas publicações.",
  },
] as const satisfies readonly {
  chave: keyof Preferencias;
  titulo: string;
  descricao: string;
}[];

export function PainelPreferencias({
  inicial,
  perfil,
  generos,
}: {
  inicial: Preferencias;
  perfil: { nome: string; avatarSeed: string };
  generos: { id: string; name: string; accent: string }[];
}) {
  const { show } = useToast();
  const [valores, setValores] = useState(inicial);
  const [nome, setNome] = useState(perfil.nome);
  const [avatarSeed, setAvatarSeed] = useState(perfil.avatarSeed);
  const [, iniciar] = useTransition();

  const persistir = (proximos: Preferencias) => {
    iniciar(async () => {
      const resultado = await salvarPreferencias({
        autoplayNext: proximos.autoplayNext,
        dataSaver: proximos.dataSaver,
        reduceMotion: proximos.reduceMotion,
        spoilerGuard: proximos.spoilerGuard,
        notifyReleases: proximos.notifyReleases,
        notifyCommunity: proximos.notifyCommunity,
        preferredQuality: proximos.preferredQuality as
          | "auto"
          | "alta"
          | "economia",
      });
      if (!resultado.ok) show("Não consegui salvar agora.", "ruim");
    });
  };

  const alternar = (chave: keyof Preferencias) => {
    const proximos = { ...valores, [chave]: !valores[chave] } as Preferencias;
    setValores(proximos);
    persistir(proximos);
  };

  const trocarQualidade = (valor: string) => {
    const proximos = { ...valores, preferredQuality: valor };
    setValores(proximos);
    persistir(proximos);
  };

  const alternarGenero = (id: string) => {
    const lista = valores.favoriteGenreIds.includes(id)
      ? valores.favoriteGenreIds.filter((item) => item !== id)
      : [...valores.favoriteGenreIds, id].slice(0, 8);
    setValores({ ...valores, favoriteGenreIds: lista });
    iniciar(async () => {
      await salvarGenerosPreferidos(lista);
    });
  };

  const salvarIdentidade = () => {
    iniciar(async () => {
      const resultado = await salvarPerfil({ nome: nome.trim(), avatarSeed });
      show(
        resultado.ok ? "Perfil atualizado" : "Confira o nome e tente de novo.",
        resultado.ok ? "bom" : "ruim",
      );
    });
  };

  return (
    <div className="space-y-8 pb-4">
      {/* Identidade -------------------------------------------------------- */}
      <section className="px-5">
        <p className="eyebrow mb-2.5">Seu perfil</p>
        <div className="surface-card rounded-panel p-4">
          <div className="flex items-center gap-3.5">
            <Avatar nome={nome || "N"} seed={avatarSeed} tamanho={52} />
            <div className="flex-1">
              <label
                htmlFor="pref-nome"
                className="mb-1.5 block text-[0.75rem] font-semibold text-cream-400"
              >
                Nome
              </label>
              <input
                id="pref-nome"
                value={nome}
                onChange={(evento) => setNome(evento.target.value)}
                maxLength={60}
                className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 text-[0.9375rem] text-cream-50 outline-none focus:border-rose-500/60"
              />
            </div>
          </div>

          <p className="mb-2 mt-4 text-[0.75rem] font-semibold text-cream-400">
            Cor do avatar
          </p>
          <div className="flex flex-wrap gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((seed) => (
              <button
                key={seed}
                type="button"
                onClick={() => setAvatarSeed(seed)}
                aria-label={`Cor ${seed}`}
                aria-pressed={avatarSeed === seed}
                className={`tap rounded-full p-0.5 transition-all ${
                  avatarSeed === seed
                    ? "ring-2 ring-cream-50"
                    : "ring-1 ring-white/10"
                }`}
              >
                <Avatar nome={nome || "N"} seed={seed} tamanho={34} />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={salvarIdentidade}
            disabled={nome.trim().length < 2}
            className="tap mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-white/8 text-[0.875rem] font-semibold text-cream-50 disabled:opacity-45"
          >
            Salvar perfil
          </button>
        </div>
      </section>

      {/* Interruptores ------------------------------------------------------ */}
      <section className="px-5">
        <p className="eyebrow mb-2.5">Reprodução e avisos</p>
        <ul className="surface-card divide-y divide-white/8 overflow-hidden rounded-panel">
          {INTERRUPTORES.map((item) => {
            const ativo = Boolean(valores[item.chave]);
            return (
              <li key={item.chave}>
                <button
                  type="button"
                  onClick={() => alternar(item.chave)}
                  role="switch"
                  aria-checked={ativo}
                  className="tap flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-semibold text-cream-50">
                      {item.titulo}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] leading-snug text-cream-600">
                      {item.descricao}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
                      ativo ? "bg-rose-600" : "bg-white/12"
                    }`}
                  >
                    <span
                      className="absolute top-1 size-5 rounded-full bg-cream-50 transition-all duration-200"
                      style={{ left: ativo ? "1.75rem" : "0.25rem" }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Qualidade --------------------------------------------------------- */}
      <section className="px-5">
        <p className="eyebrow mb-2.5">Qualidade do vídeo</p>
        <div className="flex gap-1.5">
          {QUALIDADES.map((item) => (
            <Chip
              key={item.valor}
              ativo={valores.preferredQuality === item.valor}
              onClick={() => trocarQualidade(item.valor)}
              className="flex-1"
            >
              {item.rotulo}
            </Chip>
          ))}
        </div>
      </section>

      {/* Gêneros ----------------------------------------------------------- */}
      <section className="px-5">
        <p className="eyebrow mb-1">Gêneros favoritos</p>
        <p className="mb-2.5 text-[0.8125rem] text-cream-600">
          Guiam a seção “Escolhidas para você” na Home.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {generos.map((genero) => (
            <Chip
              key={genero.id}
              ativo={valores.favoriteGenreIds.includes(genero.id)}
              onClick={() => alternarGenero(genero.id)}
            >
              {genero.name}
            </Chip>
          ))}
        </div>
      </section>
    </div>
  );
}
