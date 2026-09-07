"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  fmtCompacto,
  fmtDuracao,
  fmtMoeda,
  fmtNumero,
  fmtPercentual,
} from "@/lib/painel/numeros";

/**
 * Gráficos do painel.
 *
 * Escritos à mão em SVG, como o resto do produto desenha a própria arte. Não é
 * teimosia: uma biblioteca de gráficos traria um tema que não é o nosso, um
 * bundle grande e um conjunto de padrões (eixo duplo, arco-íris, rótulo em
 * todo ponto) que teríamos de desligar um a um.
 *
 * Regras que valem para todos:
 *
 * - **Um eixo por gráfico.** Duas medidas de escalas diferentes viram dois
 *   gráficos, nunca dois eixos y.
 * - **Cor identifica, não enfeita.** Série sozinha usa o carmim do produto;
 *   séries múltiplas usam o trio validado para daltonismo (azul, laranja,
 *   jade), no máximo três — a quarta vira "outros" ou uma tabela.
 * - **Texto usa cor de texto.** O valor ao lado da legenda é claro; quem
 *   carrega a identidade é a marca colorida, não o número.
 * - **Grade recessiva.** A linha de grade existe para ancorar a leitura, não
 *   para ser vista.
 * - **Tudo tem camada de leitura.** Passar o mouse mostra o valor exato: um
 *   gráfico sem isso obriga a estimar contra o eixo.
 */

// Trio validado (ΔE seguro em protanopia, deuteranopia e tritanopia sobre a
// superfície #17111a) — ver a nota em `paleta` abaixo.
export const SERIES = ["#4a90d9", "#dd6f3d", "#2fa877"] as const;
export const CARMIM = "#e8517a";
export const NEUTRO = "#6f5f6a";

type Ponto = { chave: string; rotulo: string; valor: number };

/**
 * Formato do eixo e do balao.
 *
 * E um descritor, e nao uma funcao, porque estes graficos sao chamados de
 * componentes de servidor — e funcao nao atravessa essa fronteira. Manter a
 * formatacao aqui tambem garante que eixo e balao nunca discordem.
 */
export type Formato =
  | "numero"
  | "compacto"
  | "duracao"
  | "moeda"
  | "percentual";

export function formatarValor(valor: number, formato: Formato = "compacto"): string {
  switch (formato) {
    case "duracao":
      return fmtDuracao(valor);
    case "moeda":
      return fmtMoeda(valor);
    case "percentual":
      return fmtPercentual(valor);
    case "numero":
      return fmtNumero(valor);
    default:
      return fmtCompacto(valor);
  }
}

// ------------------------------------------------------------- utilidades

/** Largura real do contêiner. Gráfico com largura fixa quebra em tablet. */
function useLargura<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  number,
] {
  const ref = useRef<T | null>(null);
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    const alvo = ref.current;
    if (!alvo) return;
    const observador = new ResizeObserver(([entrada]) => {
      setLargura(entrada.contentRect.width);
    });
    observador.observe(alvo);
    setLargura(alvo.getBoundingClientRect().width);
    return () => observador.disconnect();
  }, []);

  return [ref, largura];
}

/**
 * Escala do eixo de valor.
 *
 * Sempre parte do zero: área ou barra que começa em outro lugar exagera a
 * variação — é a mentira mais comum em gráfico de painel. Escolhe um teto
 * "redondo" para que os rótulos da grade sejam números que alguém leria em voz
 * alta.
 */
function tetoRedondo(maximo: number): number {
  if (maximo <= 0) return 1;
  const grandeza = 10 ** Math.floor(Math.log10(maximo));
  for (const passo of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    const candidato = passo * grandeza;
    if (candidato >= maximo) return candidato;
  }
  return 10 * grandeza;
}

function caminho(pontos: { x: number; y: number }[]): string {
  return pontos
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
}

// ------------------------------------------------------- gráfico de área

export type SerieNomeada = {
  nome: string;
  pontos: Ponto[];
  cor?: string;
  /** Série de referência (período anterior): tracejada e neutra. */
  fantasma?: boolean;
};

export function GraficoArea({
  series,
  altura = 240,
  formato = "compacto",
  rotuloEixo,
  vazio = "Sem dados no período",
}: {
  series: SerieNomeada[];
  altura?: number;
  formato?: Formato;
  rotuloEixo?: string;
  vazio?: string;
}) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const id = useId();

  const principais = series.filter((s) => !s.fantasma);
  const base = principais[0]?.pontos ?? series[0]?.pontos ?? [];

  const margem = { topo: 14, direita: 8, baixo: 26, esquerda: 46 };
  const larguraPlot = Math.max(0, largura - margem.esquerda - margem.direita);
  const alturaPlot = altura - margem.topo - margem.baixo;

  const maximo = Math.max(
    1,
    ...series.flatMap((s) => s.pontos.map((p) => p.valor)),
  );
  const teto = tetoRedondo(maximo);

  const x = useCallback(
    (i: number) =>
      base.length <= 1
        ? larguraPlot / 2
        : (i / (base.length - 1)) * larguraPlot,
    [base.length, larguraPlot],
  );
  const y = useCallback(
    (valor: number) => alturaPlot - (valor / teto) * alturaPlot,
    [alturaPlot, teto],
  );

  const temDados = series.some((s) => s.pontos.some((p) => p.valor > 0));

  /**
   * Linhas da grade.
   *
   * Sem dado, só a linha do zero: uma escada de quatro rótulos idênticos
   * (\"0s 0s 0s 0s\") é ruído que finge precisão. E mesmo com dado, dois
   * rótulos vizinhos que formatam igual viram um só — em escala pequena,
   * 0,25 min e 0,5 min imprimem o mesmo texto.
   */
  const grade = useMemo(() => {
    if (!temDados) return [0];
    const linhas = 4;
    const valores = Array.from(
      { length: linhas + 1 },
      (_, i) => (teto / linhas) * i,
    );
    const vistos = new Set<string>();
    return valores.filter((valor) => {
      const texto = formatarValor(valor, formato);
      if (vistos.has(texto)) return false;
      vistos.add(texto);
      return true;
    });
  }, [formato, temDados, teto]);

  const aoMover = (evento: React.PointerEvent<SVGSVGElement>) => {
    if (base.length === 0 || larguraPlot <= 0) return;
    const caixa = evento.currentTarget.getBoundingClientRect();
    const posicao = evento.clientX - caixa.left - margem.esquerda;
    const indice = Math.round((posicao / larguraPlot) * (base.length - 1));
    setFoco(Math.min(base.length - 1, Math.max(0, indice)));
  };

  return (
    <div ref={ref} className="relative w-full">
      {largura > 0 ? (
        <svg
          width={largura}
          height={altura}
          role="img"
          aria-label={
            rotuloEixo
              ? `${rotuloEixo} por período`
              : series.map((s) => s.nome).join(" e ")
          }
          onPointerMove={aoMover}
          onPointerLeave={() => setFoco(null)}
          style={{ touchAction: "pan-y" }}
        >
          <defs>
            {series.map((serie, i) =>
              serie.fantasma ? null : (
                <linearGradient
                  key={serie.nome}
                  id={`${id}-preenche-${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={serie.cor ?? CARMIM}
                    stopOpacity="0.26"
                  />
                  <stop
                    offset="100%"
                    stopColor={serie.cor ?? CARMIM}
                    stopOpacity="0.02"
                  />
                </linearGradient>
              ),
            )}
          </defs>

          <g transform={`translate(${margem.esquerda} ${margem.topo})`}>
            {/* Grade: recessiva, só para ancorar a leitura. */}
            {grade.map((valor) => (
              <g key={valor}>
                <line
                  x1={0}
                  x2={larguraPlot}
                  y1={y(valor)}
                  y2={y(valor)}
                  stroke="currentColor"
                  strokeOpacity={valor === 0 ? 0.18 : 0.07}
                  strokeWidth={1}
                />
                <text
                  x={-10}
                  y={y(valor)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-current text-[0.6875rem] opacity-45 tabular"
                >
                  {formatarValor(valor, formato)}
                </text>
              </g>
            ))}

            {temDados
              ? series.map((serie, i) => {
                  const cor = serie.fantasma
                    ? NEUTRO
                    : (serie.cor ?? (principais.length > 1 ? SERIES[i] : CARMIM));
                  const coords = serie.pontos.map((p, j) => ({
                    x: x(j),
                    y: y(p.valor),
                  }));
                  if (coords.length === 0) return null;

                  return (
                    <g key={serie.nome}>
                      {!serie.fantasma && coords.length > 1 ? (
                        <path
                          d={`${caminho(coords)} L${coords.at(-1)!.x} ${alturaPlot} L${coords[0].x} ${alturaPlot} Z`}
                          fill={`url(#${id}-preenche-${i})`}
                        />
                      ) : null}
                      <path
                        d={caminho(coords)}
                        fill="none"
                        stroke={cor}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={serie.fantasma ? "4 4" : undefined}
                        strokeOpacity={serie.fantasma ? 0.7 : 1}
                      />
                      {/* Um ponto só não desenha linha: vira marcador. */}
                      {coords.length === 1 ? (
                        <circle cx={coords[0].x} cy={coords[0].y} r={4} fill={cor} />
                      ) : null}
                    </g>
                  );
                })
              : null}

            {/* Leitura: linha de foco e marcadores do ponto sob o cursor. */}
            {foco !== null && temDados ? (
              <g>
                <line
                  x1={x(foco)}
                  x2={x(foco)}
                  y1={0}
                  y2={alturaPlot}
                  stroke="currentColor"
                  strokeOpacity={0.28}
                  strokeWidth={1}
                />
                {series.map((serie, i) => {
                  const ponto = serie.pontos[foco];
                  if (!ponto) return null;
                  const cor = serie.fantasma
                    ? NEUTRO
                    : (serie.cor ?? (principais.length > 1 ? SERIES[i] : CARMIM));
                  return (
                    <circle
                      key={serie.nome}
                      cx={x(foco)}
                      cy={y(ponto.valor)}
                      r={4.5}
                      fill={cor}
                      // Anel da cor da superfície: separa marcas sobrepostas.
                      stroke="var(--p-superficie)"
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            ) : null}

            {/* Eixo do tempo: no máximo seis marcas, senão vira borrão. */}
            {base.map((ponto, i) => {
              const maximoDeMarcas = largura < 480 ? 4 : 6;
              const passo = Math.max(
                1,
                Math.ceil((base.length - 1) / (maximoDeMarcas - 1)),
              );
              if (i % passo !== 0 && i !== base.length - 1) return null;
              return (
                <text
                  key={ponto.chave}
                  x={x(i)}
                  y={alturaPlot + 17}
                  textAnchor={
                    i === 0 ? "start" : i === base.length - 1 ? "end" : "middle"
                  }
                  className="fill-current text-[0.6875rem] opacity-45 tabular"
                >
                  {ponto.rotulo}
                </text>
              );
            })}
          </g>
        </svg>
      ) : (
        <div style={{ height: altura }} />
      )}

      {!temDados && largura > 0 ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.8125rem] text-[var(--p-fraco)]">
          {vazio}
        </p>
      ) : null}

      {foco !== null && temDados ? (
        <Balao
          x={margem.esquerda + x(foco)}
          largura={largura}
          titulo={base[foco]?.rotulo ?? ""}
          linhas={series.map((serie, i) => ({
            nome: serie.nome,
            cor: serie.fantasma
              ? NEUTRO
              : (serie.cor ?? (principais.length > 1 ? SERIES[i] : CARMIM)),
            valor: formatarValor(serie.pontos[foco]?.valor ?? 0, formato),
            tracejado: serie.fantasma,
          }))}
        />
      ) : null}
    </div>
  );
}

/** Balão de leitura. Segue o cursor e vira de lado antes de sair da caixa. */
function Balao({
  x,
  largura,
  titulo,
  linhas,
}: {
  x: number;
  largura: number;
  titulo: string;
  linhas: { nome: string; cor: string; valor: string; tracejado?: boolean }[];
}) {
  const larguraBalao = 168;
  const paraEsquerda = x + larguraBalao + 16 > largura;

  return (
    <div
      className="pointer-events-none absolute top-2 z-10 rounded-lg border border-[var(--p-linha-forte)] bg-[var(--p-alto)] px-3 py-2 shadow-[0_0.75rem_1.5rem_-0.5rem_rgb(0_0_0/0.6)]"
      style={{
        width: larguraBalao,
        left: paraEsquerda ? undefined : x + 12,
        right: paraEsquerda ? largura - x + 12 : undefined,
      }}
    >
      <p className="mb-1.5 text-[0.6875rem] font-semibold text-[var(--p-suave)]">
        {titulo}
      </p>
      <ul className="space-y-1">
        {linhas.map((linha) => (
          <li key={linha.nome} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{
                background: linha.tracejado
                  ? `repeating-linear-gradient(90deg, ${linha.cor} 0 3px, transparent 3px 6px)`
                  : linha.cor,
              }}
            />
            <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-[var(--p-fraco)]">
              {linha.nome}
            </span>
            <span className="tabular text-[0.75rem] font-semibold text-[var(--p-texto)]">
              {linha.valor}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------- gráfico de barras

export function GraficoBarras({
  pontos,
  altura = 180,
  cor = CARMIM,
  formato = "compacto",
  vazio = "Sem dados no período",
  destacar,
}: {
  pontos: Ponto[];
  altura?: number;
  cor?: string;
  formato?: Formato;
  vazio?: string;
  /** Índice a realçar — por exemplo, a hora de agora. */
  destacar?: number;
}) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);

  const margem = { topo: 12, direita: 4, baixo: 24, esquerda: 42 };
  const larguraPlot = Math.max(0, largura - margem.esquerda - margem.direita);
  const alturaPlot = altura - margem.topo - margem.baixo;

  const maximo = Math.max(1, ...pontos.map((p) => p.valor));
  const teto = tetoRedondo(maximo);
  const temDados = pontos.some((p) => p.valor > 0);

  // 2px de respiro entre barras vizinhas: sem isso, barras adjacentes leem
  // como uma massa só.
  const passo = pontos.length > 0 ? larguraPlot / pontos.length : 0;
  const larguraBarra = Math.max(2, passo - 2);

  return (
    <div ref={ref} className="relative w-full">
      {largura > 0 ? (
        <svg width={largura} height={altura} role="img" aria-label="Distribuição">
          <g transform={`translate(${margem.esquerda} ${margem.topo})`}>
            {(temDados
              ? [0, teto / 2, teto].filter(
                  (valor, i, todos) =>
                    todos.findIndex(
                      (outro) =>
                        formatarValor(outro, formato) ===
                        formatarValor(valor, formato),
                    ) === i,
                )
              : [0]
            ).map((valor) => (
              <g key={valor}>
                <line
                  x1={0}
                  x2={larguraPlot}
                  y1={alturaPlot - (valor / teto) * alturaPlot}
                  y2={alturaPlot - (valor / teto) * alturaPlot}
                  stroke="currentColor"
                  strokeOpacity={valor === 0 ? 0.18 : 0.07}
                />
                <text
                  x={-8}
                  y={alturaPlot - (valor / teto) * alturaPlot}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-current text-[0.6875rem] opacity-45 tabular"
                >
                  {formatarValor(valor, formato)}
                </text>
              </g>
            ))}

            {pontos.map((ponto, i) => {
              const h = (ponto.valor / teto) * alturaPlot;
              const realce = destacar === i;
              return (
                <g
                  key={ponto.chave}
                  onPointerEnter={() => setFoco(i)}
                  onPointerLeave={() => setFoco(null)}
                >
                  {/* Alvo de leitura maior que a marca. */}
                  <rect
                    x={i * passo}
                    y={0}
                    width={passo}
                    height={alturaPlot}
                    fill="transparent"
                  />
                  <rect
                    x={i * passo + (passo - larguraBarra) / 2}
                    y={alturaPlot - h}
                    width={larguraBarra}
                    height={Math.max(ponto.valor > 0 ? 2 : 0, h)}
                    rx={Math.min(4, larguraBarra / 2)}
                    fill={realce ? CARMIM : cor}
                    fillOpacity={foco === null || foco === i ? (realce ? 1 : 0.85) : 0.4}
                  />
                </g>
              );
            })}

            {pontos.map((ponto, i) => {
              const salto = Math.max(1, Math.ceil(pontos.length / 8));
              if (i % salto !== 0) return null;
              return (
                <text
                  key={ponto.chave}
                  x={i * passo + passo / 2}
                  y={alturaPlot + 16}
                  textAnchor="middle"
                  className="fill-current text-[0.6875rem] opacity-45 tabular"
                >
                  {ponto.rotulo}
                </text>
              );
            })}
          </g>
        </svg>
      ) : (
        <div style={{ height: altura }} />
      )}

      {!temDados && largura > 0 ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.8125rem] text-[var(--p-fraco)]">
          {vazio}
        </p>
      ) : null}

      {foco !== null && pontos[foco] ? (
        <Balao
          x={margem.esquerda + foco * passo + passo / 2}
          largura={largura}
          titulo={pontos[foco].rotulo}
          linhas={[
            { nome: "Total", cor, valor: formatarValor(pontos[foco].valor, formato) },
          ]}
        />
      ) : null}
    </div>
  );
}

// -------------------------------------------------- ranking horizontal

/**
 * Ranking. Barra horizontal porque o rótulo é um nome — nome em barra
 * vertical vira texto de lado, que ninguém lê.
 */
export function BarrasRanking({
  itens,
  formato = "compacto",
  cor = CARMIM,
  vazio = "Nada registrado no período",
}: {
  itens: { chave: string; rotulo: string; valor: number; href?: string; nota?: string }[];
  formato?: Formato;
  cor?: string;
  vazio?: string;
}) {
  const maximo = Math.max(1, ...itens.map((i) => i.valor));

  if (itens.length === 0) {
    return (
      <p className="py-8 text-center text-[0.8125rem] text-[var(--p-fraco)]">
        {vazio}
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {itens.map((item) => (
        <li key={item.chave}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-[var(--p-texto)]">
              {item.rotulo}
            </span>
            {item.nota ? (
              <span className="shrink-0 text-[0.6875rem] text-[var(--p-fraco)]">
                {item.nota}
              </span>
            ) : null}
            <span className="tabular shrink-0 text-[0.8125rem] font-semibold text-[var(--p-texto)]">
              {formatarValor(item.valor, formato)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--p-elevado)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(item.valor > 0 ? 2 : 0, (item.valor / maximo) * 100)}%`,
                background: cor,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------ mapa de calor

/**
 * Mapa de calor hora × dia da semana. Rampa de um tom só, claro para escuro —
 * magnitude não é identidade, então nunca arco-íris.
 */
export function MapaDeCalor({
  celulas,
  formato = "compacto",
}: {
  /** 7 linhas (dom→sáb) × 24 colunas. */
  celulas: number[][];
  formato?: Formato;
}) {
  const [foco, setFoco] = useState<{ dia: number; hora: number } | null>(null);
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const maximo = Math.max(1, ...celulas.flat());

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[34rem]">
        <div className="mb-1 flex gap-px pl-9">
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              className="tabular flex-1 text-center text-[0.5625rem] text-[var(--p-fraco)]"
            >
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
        </div>
        {celulas.map((linha, dia) => (
          <div key={dia} className="mb-px flex items-center gap-px">
            <span className="w-9 shrink-0 text-[0.625rem] text-[var(--p-fraco)]">
              {dias[dia]}
            </span>
            {linha.map((valor, hora) => {
              const intensidade = valor / maximo;
              const ativo = foco?.dia === dia && foco?.hora === hora;
              return (
                <button
                  key={hora}
                  type="button"
                  onPointerEnter={() => setFoco({ dia, hora })}
                  onPointerLeave={() => setFoco(null)}
                  onFocus={() => setFoco({ dia, hora })}
                  onBlur={() => setFoco(null)}
                  aria-label={`${dias[dia]} ${hora}h: ${formatarValor(valor, formato)}`}
                  className="h-5 flex-1 rounded-[3px] transition-transform"
                  style={{
                    background:
                      valor === 0
                        ? "var(--p-elevado)"
                        : `color-mix(in oklab, ${CARMIM} ${12 + intensidade * 88}%, var(--p-fundo))`,
                    outline: ativo ? "1px solid var(--p-texto)" : undefined,
                  }}
                />
              );
            })}
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[0.6875rem] text-[var(--p-fraco)]">
            {foco
              ? `${dias[foco.dia]}, ${foco.hora}h — ${formatarValor(celulas[foco.dia][foco.hora], formato)}`
              : "Passe o cursor para ver o valor de cada faixa"}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-[0.625rem] text-[var(--p-fraco)]">menos</span>
            {[0, 0.25, 0.5, 0.75, 1].map((n) => (
              <span
                key={n}
                className="h-2.5 w-4 rounded-[2px]"
                style={{
                  background:
                    n === 0
                      ? "var(--p-elevado)"
                      : `color-mix(in oklab, ${CARMIM} ${12 + n * 88}%, var(--p-fundo))`,
                }}
              />
            ))}
            <span className="text-[0.625rem] text-[var(--p-fraco)]">mais</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Legenda. Presente sempre que houver duas séries ou mais. */
export function Legenda({
  itens,
}: {
  itens: { nome: string; cor: string; tracejado?: boolean }[];
}) {
  if (itens.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {itens.map((item) => (
        <li key={item.nome} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0.5 w-3.5 rounded-full"
            style={{
              background: item.tracejado
                ? `repeating-linear-gradient(90deg, ${item.cor} 0 3px, transparent 3px 6px)`
                : item.cor,
            }}
          />
          <span className="text-[0.6875rem] text-[var(--p-suave)]">{item.nome}</span>
        </li>
      ))}
    </ul>
  );
}
