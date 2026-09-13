"use client";

import { useEffect, useRef, useState } from "react";

import { recortarFotoPerfil } from "@/components/perfil/prepararFoto";
import { IconeCheck } from "@/components/ui/icones";

const LADO_REFERENCIA = 300;
const ZOOM_MINIMO = 1;
const ZOOM_MAXIMO = 4;

type Dimensoes = { largura: number; altura: number };
type Posicao = { x: number; y: number };
type Ponto = { x: number; y: number };

/** Editor de avatar por gesto: arrastar move a foto; dois dedos aproximam. */
export function EditorRecorteFoto({
  arquivo,
  aoCancelar,
  aoSalvar,
}: {
  arquivo: File | null;
  aoCancelar: () => void;
  aoSalvar: (foto: File) => Promise<void> | void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [dimensoes, setDimensoes] = useState<Dimensoes | null>(null);
  const [zoom, setZoom] = useState(ZOOM_MINIMO);
  const [posicao, setPosicao] = useState<Posicao>({ x: 0, y: 0 });
  const [lado, setLado] = useState(LADO_REFERENCIA);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const moldura = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);
  const ponteiros = useRef(new Map<number, Ponto>());
  const gesto = useRef<{
    posicao: Posicao;
    zoom: number;
    ponto?: Ponto;
    centro?: Ponto;
    distancia?: number;
  } | null>(null);

  useEffect(() => {
    if (!arquivo) return;
    focoAnterior.current = document.activeElement as HTMLElement | null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape" && !salvando) aoCancelar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener("keydown", aoTeclar);
      focoAnterior.current?.focus();
    };
  }, [arquivo, aoCancelar, salvando]);

  useEffect(() => {
    const elemento = moldura.current;
    if (!arquivo || !elemento) return;
    const atualizar = () => setLado(elemento.clientWidth || LADO_REFERENCIA);
    atualizar();
    const observador = new ResizeObserver(atualizar);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [arquivo]);

  useEffect(() => {
    if (!arquivo) {
      setUrl(null);
      return;
    }
    const proximaUrl = URL.createObjectURL(arquivo);
    setUrl(proximaUrl);
    setDimensoes(null);
    setZoom(ZOOM_MINIMO);
    setPosicao({ x: 0, y: 0 });
    setErro(null);
    return () => URL.revokeObjectURL(proximaUrl);
  }, [arquivo]);

  const limitar = (proxima: Posicao, proximoZoom = zoom): Posicao => {
    if (!dimensoes) return proxima;
    const escala = Math.max(lado / dimensoes.largura, lado / dimensoes.altura) * proximoZoom;
    const limiteX = Math.max(0, (dimensoes.largura * escala - lado) / 2);
    const limiteY = Math.max(0, (dimensoes.altura * escala - lado) / 2);
    return {
      x: Math.max(-limiteX, Math.min(limiteX, proxima.x)),
      y: Math.max(-limiteY, Math.min(limiteY, proxima.y)),
    };
  };

  const definirZoom = (proximo: number, origem = posicao) => {
    const zoomLimitado = Math.max(ZOOM_MINIMO, Math.min(ZOOM_MAXIMO, proximo));
    setZoom(zoomLimitado);
    setPosicao(limitar(origem, zoomLimitado));
  };

  const salvar = async () => {
    if (!arquivo || !dimensoes) return;
    setErro(null);
    setSalvando(true);
    try {
      const foto = await recortarFotoPerfil(arquivo, {
        escala: zoom,
        deslocamentoX: posicao.x * (LADO_REFERENCIA / lado),
        deslocamentoY: posicao.y * (LADO_REFERENCIA / lado),
      });
      await aoSalvar(foto);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui preparar essa foto. Tente outra imagem.");
    } finally {
      setSalvando(false);
    }
  };

  const distancia = ([a, b]: Ponto[]) => Math.hypot(a.x - b.x, a.y - b.y);
  const centro = ([a, b]: Ponto[]): Ponto => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const escala = dimensoes ? Math.max(lado / dimensoes.largura, lado / dimensoes.altura) * zoom : 1;

  if (!arquivo) return null;

  return (
    <div className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col bg-ink-950 text-cream-50" role="dialog" aria-modal="true" aria-labelledby="titulo-editor-foto">
      <header className="flex h-16 shrink-0 items-center justify-between px-4" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <button type="button" onClick={aoCancelar} disabled={salvando} className="tap min-w-20 py-2 text-left text-[0.9375rem] font-semibold text-cream-200 disabled:opacity-45">Cancelar</button>
        <h2 id="titulo-editor-foto" className="text-[0.9375rem] font-semibold tracking-normal">Mover e dimensionar</h2>
        <button type="button" onClick={() => void salvar()} disabled={!dimensoes || salvando} className="tap flex min-w-20 items-center justify-end gap-1.5 py-2 text-[0.9375rem] font-bold text-rose-300 disabled:opacity-45">
          {salvando ? "Salvando…" : <><IconeCheck tamanho={17} /> Concluir</>}
        </button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-5">
        <div
          ref={moldura}
          className="relative aspect-square w-[min(82vw,25rem)] touch-none overflow-hidden rounded-full bg-ink-850 shadow-[0_1.5rem_4rem_-1.5rem_rgb(0_0_0_/_0.9)] ring-2 ring-cream-50"
          aria-label="Área circular da foto de perfil"
          onPointerDown={(evento) => {
            if (!dimensoes || salvando) return;
            evento.currentTarget.setPointerCapture(evento.pointerId);
            ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
            const pontos = [...ponteiros.current.values()];
            gesto.current = pontos.length === 1
              ? { posicao, zoom, ponto: pontos[0] }
              : { posicao, zoom, centro: centro(pontos), distancia: distancia(pontos) };
          }}
          onPointerMove={(evento) => {
            if (!ponteiros.current.has(evento.pointerId) || !gesto.current) return;
            ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
            const pontos = [...ponteiros.current.values()];
            if (pontos.length === 1 && gesto.current.ponto) {
              setPosicao(limitar({ x: gesto.current.posicao.x + evento.clientX - gesto.current.ponto.x, y: gesto.current.posicao.y + evento.clientY - gesto.current.ponto.y }));
            }
            if (pontos.length >= 2 && gesto.current.distancia && gesto.current.centro) {
              const proximoZoom = gesto.current.zoom * (distancia(pontos) / gesto.current.distancia);
              const proximoCentro = centro(pontos);
              definirZoom(proximoZoom, { x: gesto.current.posicao.x + proximoCentro.x - gesto.current.centro.x, y: gesto.current.posicao.y + proximoCentro.y - gesto.current.centro.y });
            }
          }}
          onPointerUp={(evento) => { ponteiros.current.delete(evento.pointerId); gesto.current = null; }}
          onPointerCancel={(evento) => { ponteiros.current.delete(evento.pointerId); gesto.current = null; }}
        >
          {url ? <img src={url} alt="Prévia da nova foto de perfil" draggable={false} onLoad={(evento) => setDimensoes({ largura: evento.currentTarget.naturalWidth, altura: evento.currentTarget.naturalHeight })} className="pointer-events-none absolute max-w-none select-none" style={dimensoes ? { width: dimensoes.largura * escala, height: dimensoes.altura * escala, left: (lado - dimensoes.largura * escala) / 2 + posicao.x, top: (lado - dimensoes.altura * escala) / 2 + posicao.y } : { opacity: 0 }} /> : null}
        </div>
        <p className="mt-6 text-center text-[0.8125rem] leading-relaxed text-cream-400">Arraste com um dedo para mover. Use dois dedos para aproximar.</p>
      </main>

      <section className="shrink-0 px-7 pb-7" style={{ paddingBottom: "calc(var(--safe-b) + 1.75rem)" }} aria-label="Controles de ajuste">
        <label className="mx-auto block max-w-sm">
          <span className="sr-only">Aproximação da foto</span>
          <input type="range" min={ZOOM_MINIMO} max={ZOOM_MAXIMO} step="0.01" value={zoom} onChange={(evento) => definirZoom(Number(evento.target.value))} className="h-1.5 w-full cursor-pointer accent-rose-400" />
        </label>
        <button type="button" onClick={() => { definirZoom(ZOOM_MINIMO, { x: 0, y: 0 }); }} disabled={salvando} className="tap mx-auto mt-5 block text-[0.8125rem] font-semibold text-cream-400 hover:text-cream-50 disabled:opacity-45">Redefinir ajuste</button>
        {erro ? <p role="alert" className="mx-auto mt-3 max-w-sm text-center text-[0.75rem] leading-relaxed text-rose-300">{erro}</p> : null}
      </section>
    </div>
  );
}
