"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  salvarPerfil,
  salvarPreferencias,
} from "@/lib/actions/conta";
import { useToast } from "@/components/sistema/ToastProvider";
import { Avatar } from "@/components/ui/primitivos";
import { IconeCamera } from "@/components/ui/icones";
import { EditorRecorteFoto } from "@/components/perfil/EditorRecorteFoto";
import {
  CampoDeHandle,
  handleProntoParaSalvar,
  type EstadoDoHandle,
} from "@/components/perfil/CampoDeHandle";
import { normalizarHandle } from "@/lib/auth/identidade";

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
};

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
    descricao: "O episódio só é baixado quando você manda tocar.",
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
}: {
  inicial: Preferencias;
  perfil: { nome: string; handle: string; avatarSeed: string; avatarUrl: string | null };
}) {
  const { show } = useToast();
  const router = useRouter();
  const [valores, setValores] = useState(inicial);
  const [nome, setNome] = useState(perfil.nome);
  const [handle, setHandle] = useState(perfil.handle);
  const [handleSalvo, setHandleSalvo] = useState(perfil.handle);
  const [estadoHandle, setEstadoHandle] = useState<EstadoDoHandle>("seu");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [avatarSeed, setAvatarSeed] = useState(perfil.avatarSeed);
  const [fotoUrl, setFotoUrl] = useState(perfil.avatarUrl);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);
  const [arquivoSelecionado, setArquivoSelecionado] = useState<File | null>(null);
  const [, iniciar] = useTransition();

  const enviarFoto = async (foto: File) => {
    const anterior = fotoUrl;
    let previa: string | null = null;
    setErroFoto(null);
    setEnviandoFoto(true);

    try {
      previa = URL.createObjectURL(foto);
      setFotoUrl(previa);

      const formData = new FormData();
      formData.set("foto", foto);
      const response = await fetch("/api/perfil/avatar", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        ok: boolean;
        avatarUrl?: string;
        message?: string;
      };
      if (!response.ok || !result.ok || !result.avatarUrl) {
        throw new Error(result.message || "Não foi possível salvar a foto.");
      }

      setFotoUrl(result.avatarUrl);
      show("Foto de perfil atualizada", "bom");
      router.refresh();
    } catch (error) {
      setFotoUrl(anterior);
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a foto agora.";
      setErroFoto(message);
      show(message, "ruim");
    } finally {
      if (previa) URL.revokeObjectURL(previa);
      setEnviandoFoto(false);
      if (inputFoto.current) inputFoto.current.value = "";
      setArquivoSelecionado(null);
    }
  };

  const removerFoto = async () => {
    setErroFoto(null);
    setEnviandoFoto(true);
    try {
      const response = await fetch("/api/perfil/avatar", { method: "DELETE" });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Não foi possível remover a foto.");
      }
      setFotoUrl(null);
      show("Foto removida", "bom");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível remover a foto agora.";
      setErroFoto(message);
      show(message, "ruim");
    } finally {
      setEnviandoFoto(false);
    }
  };

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

  const salvarIdentidade = () => {
    setSalvandoPerfil(true);
    iniciar(async () => {
      try {
        const resultado = await salvarPerfil({ nome: nome.trim(), handle, avatarSeed });
        if (resultado.ok) {
          setHandleSalvo(normalizarHandle(handle));
          show("Perfil atualizado", "bom");
          router.refresh();
        } else {
          show(resultado.erro, "ruim");
        }
      } finally {
        setSalvandoPerfil(false);
      }
    });
  };

  return (
    <div className="space-y-8 pb-4">
      {/* Identidade -------------------------------------------------------- */}
      <section id="seu-perfil" className="scroll-mt-4 px-5">
        <p className="eyebrow mb-2.5">Seu perfil</p>
        <div className="surface-card rounded-panel p-4">
          <div className="flex items-start gap-3.5">
            <div className="relative shrink-0">
              <Avatar
                nome={nome || "N"}
                seed={avatarSeed}
                fotoUrl={fotoUrl}
                tamanho={64}
              />
              <button
                type="button"
                onClick={() => inputFoto.current?.click()}
                disabled={enviandoFoto}
                aria-label={
                  fotoUrl ? "Trocar foto de perfil" : "Adicionar foto de perfil"
                }
                className="tap absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border border-ink-950 bg-rose-600 text-cream-50 shadow-lift disabled:opacity-50"
              >
                <IconeCamera tamanho={16} />
              </button>
              <input
                ref={inputFoto}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setArquivoSelecionado(file);
                }}
              />
            </div>
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
                autoComplete="name"
                className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 text-[0.9375rem] text-cream-50 outline-none focus:border-rose-500/60"
              />

              <label
                htmlFor="pref-handle"
                className="mt-3 mb-1.5 block text-[0.75rem] font-semibold text-cream-400"
              >
                Nome de usuário
              </label>
              <CampoDeHandle
                id="pref-handle"
                valor={handle}
                atual={handleSalvo}
                aoMudar={setHandle}
                aoEstado={setEstadoHandle}
              />

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button
                  type="button"
                  onClick={() => inputFoto.current?.click()}
                  disabled={enviandoFoto}
                  className="tap text-[0.8125rem] font-semibold text-rose-300 disabled:opacity-50"
                >
                  {enviandoFoto
                    ? "Enviando…"
                    : fotoUrl
                      ? "Trocar foto"
                      : "Adicionar foto"}
                </button>
                {fotoUrl && !enviandoFoto ? (
                  <button
                    type="button"
                    onClick={() => void removerFoto()}
                    className="tap text-[0.8125rem] font-semibold text-cream-600"
                  >
                    Remover
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-cream-600">
                Fotos de até 20 MB. O app reduz o arquivo antes de enviar e
                ajusta o enquadramento para o formato quadrado.
              </p>
              {erroFoto ? (
                <p
                  role="alert"
                  className="mt-2 text-[0.6875rem] leading-relaxed text-rose-300"
                >
                  {erroFoto}
                </p>
              ) : null}
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
            disabled={
              salvandoPerfil ||
              nome.trim().length < 2 ||
              !handleProntoParaSalvar(estadoHandle)
            }
            className="tap mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-white/8 text-[0.875rem] font-semibold text-cream-50 disabled:opacity-45"
          >
            {salvandoPerfil ? "Salvando…" : "Salvar perfil"}
          </button>
        </div>
      </section>

      <EditorRecorteFoto
        arquivo={arquivoSelecionado}
        aoCancelar={() => { setArquivoSelecionado(null); if (inputFoto.current) inputFoto.current.value = ""; }}
        aoSalvar={enviarFoto}
      />

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

      {/* Aviso honesto: as duas últimas chaves guardam a escolha, mas ainda não
          existe envio de notificação. Melhor dizer do que deixar a pessoa
          esperando um aviso que não vem. */}
      <p className="-mt-5 px-6 text-[0.75rem] leading-relaxed text-cream-600">
        Os avisos ficam guardados na sua conta e passam a valer assim que as
        notificações forem ligadas no aplicativo.
      </p>

    </div>
  );
}
