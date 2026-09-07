import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import {
  fmtVariacao,
  tomDaVariacao,
  type Indicador,
  type Sentido,
} from "@/lib/painel/numeros";
import {
  IconeDescendo,
  IconeEstavel,
  IconeSetaDireita,
  IconeSubindo,
} from "@/components/painel/icones";

/**
 * Peças do painel.
 *
 * A decisão que organiza este arquivo: **o painel não é uma grade de cartões**.
 * Cartão do mesmo tamanho repetido é o jeito preguiçoso de arrumar um
 * dashboard — cada número ganha o mesmo peso, e a tela deixa de ter hierarquia
 * justamente onde hierarquia é o produto. Aqui os números moram em um livro-
 * razão alinhado (`Razao`), e a superfície elevada é reservada ao que de fato
 * é uma unidade: um gráfico, uma tabela, um bloco de investigação.
 */

// ------------------------------------------------------------- superfícies

export function Bloco({
  titulo,
  descricao,
  acao,
  children,
  className = "",
  compacto,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
  compacto?: boolean;
}) {
  return (
    <section
      className={`painel-cartao overflow-hidden ${className}`}
    >
      {titulo ? (
        <header
          className={`flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-linha)] ${
            compacto ? "px-4 py-3" : "px-5 py-4"
          }`}
        >
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              {titulo}
            </h2>
            {descricao ? (
              <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
                {descricao}
              </p>
            ) : null}
          </div>
          {acao ? <div className="shrink-0">{acao}</div> : null}
        </header>
      ) : null}
      <div className={compacto ? "p-4" : "p-5"}>{children}</div>
    </section>
  );
}

// --------------------------------------------------------- livro-razão

/**
 * A lista de indicadores.
 *
 * Números empilhados e alinhados à direita, com a variação ao lado. Lê-se de
 * cima a baixo como um extrato — é mais rápido de varrer que oito cartões e,
 * por caber mais, deixa espaço para o gráfico que realmente precisa ser grande.
 */
export function Razao({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-[var(--p-linha)]">{children}</ul>
  );
}

export function LinhaRazao({
  rotulo,
  valor,
  indicador,
  sentido = "maior-melhor",
  nota,
  href,
  destaque,
}: {
  rotulo: string;
  valor: string;
  indicador?: Indicador;
  sentido?: Sentido;
  nota?: ReactNode;
  href?: string;
  destaque?: boolean;
}) {
  const conteudo = (
    <>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate ${
            destaque
              ? "text-[0.8125rem] text-[var(--p-suave)]"
              : "text-[0.8125rem] text-[var(--p-suave)]"
          }`}
        >
          {rotulo}
        </p>
        {nota ? (
          <p className="mt-0.5 text-[0.6875rem] text-[var(--p-fraco)]">{nota}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-baseline gap-3">
        <span
          className={`numero font-semibold text-[var(--p-texto)] ${
            destaque ? "text-[1.375rem]" : "text-[1rem]"
          }`}
        >
          {valor}
        </span>
        {indicador ? (
          <Variacao indicador={indicador} sentido={sentido} />
        ) : null}
      </div>
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="painel-linha -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5"
        >
          {conteudo}
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-2.5">{conteudo}</div>
      )}
    </li>
  );
}

/** Variação contra o período anterior, com cor que respeita o sentido. */
export function Variacao({
  indicador,
  sentido = "maior-melhor",
  miudo,
}: {
  indicador: Indicador;
  sentido?: Sentido;
  miudo?: boolean;
}) {
  const tom = tomDaVariacao(indicador.variacao, sentido);
  const cor =
    tom === "bom"
      ? "text-[var(--p-bom)]"
      : tom === "ruim"
        ? "text-[var(--p-perigo)]"
        : "text-[var(--p-fraco)]";

  // Sem base de comparação não existe variação. Mostrar "+100%" quando o
  // anterior era zero seria inventar significado onde não há.
  if (indicador.variacao === null) {
    const diferenca = indicador.diferenca;
    return (
      <span
        className={`tabular inline-flex w-16 items-center justify-end gap-1 text-[0.75rem] text-[var(--p-fraco)]`}
        title={
          indicador.anterior === null
            ? "Sem período anterior para comparar"
            : `Período anterior: ${indicador.anterior}`
        }
      >
        {diferenca && diferenca > 0 ? (
          <>
            <IconeSubindo tamanho={12} />
            <span>novo</span>
          </>
        ) : (
          <>
            <IconeEstavel tamanho={12} />
            <span>—</span>
          </>
        )}
      </span>
    );
  }

  const Icone =
    indicador.variacao > 0
      ? IconeSubindo
      : indicador.variacao < 0
        ? IconeDescendo
        : IconeEstavel;

  return (
    <span
      className={`tabular inline-flex ${miudo ? "" : "w-16"} items-center justify-end gap-1 text-[0.75rem] font-medium ${cor}`}
      title={`Período anterior: ${Math.round(indicador.anterior ?? 0)}`}
    >
      <Icone tamanho={12} />
      {fmtVariacao(indicador.variacao)}
    </span>
  );
}

// ------------------------------------------------------------------ selos

type TomSelo = "neutro" | "bom" | "atencao" | "perigo" | "info" | "acento";

const TONS: Record<TomSelo, string> = {
  neutro: "bg-white/6 text-[var(--p-suave)] border-white/8",
  bom: "bg-[var(--p-bom-fundo)] text-[var(--p-bom)] border-[var(--p-bom)]/25",
  atencao:
    "bg-[var(--p-atencao-fundo)] text-[var(--p-atencao)] border-[var(--p-atencao)]/25",
  perigo:
    "bg-[var(--p-perigo-fundo)] text-[var(--p-perigo)] border-[var(--p-perigo)]/25",
  info: "bg-[var(--p-info-fundo)] text-[var(--p-info)] border-[var(--p-info)]/25",
  acento: "bg-[var(--p-acento-suave)] text-[var(--color-rose-400)] border-[var(--color-rose-500)]/25",
};

export function Selo({
  children,
  tom = "neutro",
  icone,
  className = "",
}: {
  children: ReactNode;
  tom?: TomSelo;
  icone?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap ${TONS[tom]} ${className}`}
    >
      {icone}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- botões

type VarianteBotao = "principal" | "sutil" | "fantasma" | "perigo";

const BOTOES: Record<VarianteBotao, string> = {
  principal:
    "bg-[var(--color-rose-600)] text-white hover:bg-[var(--color-rose-500)] active:bg-[var(--color-rose-700)]",
  sutil:
    "bg-white/6 text-[var(--p-texto)] border border-[var(--p-linha-forte)] hover:bg-white/10 active:bg-white/13",
  fantasma:
    "text-[var(--p-suave)] hover:bg-white/6 hover:text-[var(--p-texto)] active:bg-white/10",
  perigo:
    "bg-[var(--p-perigo)]/14 text-[var(--p-perigo)] border border-[var(--p-perigo)]/30 hover:bg-[var(--p-perigo)]/22",
};

const BASE_BOTAO =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 h-8 text-[0.8125rem] font-medium transition-colors disabled:opacity-45 disabled:pointer-events-none";

export function BotaoPainel({
  variante = "sutil",
  className = "",
  ...props
}: ComponentProps<"button"> & { variante?: VarianteBotao }) {
  return (
    <button
      {...props}
      className={`${BASE_BOTAO} ${BOTOES[variante]} ${className}`}
    />
  );
}

export function LinkPainel({
  variante = "sutil",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variante?: VarianteBotao }) {
  return (
    <Link {...props} className={`${BASE_BOTAO} ${BOTOES[variante]} ${className}`} />
  );
}

// --------------------------------------------------------------- estados

/**
 * Estado vazio.
 *
 * Ensina a interface em vez de dizer "nada aqui": explica por que está vazio e
 * o que fazer a respeito. Num painel isso importa mais que no aplicativo —
 * uma tabela vazia pode significar "não aconteceu" ou "não estamos medindo", e
 * confundir as duas custa caro.
 */
export function Vazio({
  titulo,
  descricao,
  acao,
  icone,
}: {
  titulo: string;
  descricao?: ReactNode;
  acao?: ReactNode;
  icone?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icone ? (
        <span className="mb-3 text-[var(--p-fraco)] opacity-60">{icone}</span>
      ) : null}
      <p className="text-[0.9375rem] font-medium text-[var(--p-suave)]">
        {titulo}
      </p>
      {descricao ? (
        <p className="mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-[var(--p-fraco)]">
          {descricao}
        </p>
      ) : null}
      {acao ? <div className="mt-4">{acao}</div> : null}
    </div>
  );
}

/** Esqueleto de carregamento: o formato do que vem, não um giro no vazio. */
export function Esqueleto({
  className = "",
  linhas = 1,
}: {
  className?: string;
  linhas?: number;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className={`skeleton rounded-md ${className || "h-4 w-full"}`}
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

/**
 * Aviso de cobertura de dado.
 *
 * Aparece quando a métrica só existe a partir de certa data — o gráfico mostra
 * zero antes disso, e sem esta linha o zero pareceria "caiu" em vez de
 * "não medíamos".
 */
export function NotaDeCobertura({
  desde,
  oQue,
}: {
  desde: Date | null;
  oQue: string;
}) {
  if (!desde) {
    return (
      <p className="text-[0.6875rem] text-[var(--p-atencao)]">
        {oQue} ainda não tem nenhum registro — a instrumentação está no ar, os
        dados aparecem conforme o uso.
      </p>
    );
  }
  return (
    <p className="text-[0.6875rem] text-[var(--p-fraco)]">
      {oQue} é medido desde{" "}
      {new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(desde)}
      . Antes disso o gráfico mostra zero porque não havia medição, não porque
      houve queda.
    </p>
  );
}

// ---------------------------------------------------------------- tabela

export function Tabela({
  cabecalho,
  children,
  className = "",
}: {
  cabecalho: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full min-w-full border-collapse text-left">
        <thead className="painel-cabecalho-fixo">{cabecalho}</thead>
        <tbody className="divide-y divide-[var(--p-linha)]">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  alinhar = "esquerda",
  className = "",
}: {
  children: ReactNode;
  alinhar?: "esquerda" | "direita" | "centro";
  className?: string;
}) {
  const al =
    alinhar === "direita"
      ? "text-right"
      : alinhar === "centro"
        ? "text-center"
        : "text-left";
  return (
    <th
      scope="col"
      className={`px-3 py-2.5 text-[0.6875rem] font-semibold whitespace-nowrap text-[var(--p-fraco)] ${al} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  alinhar = "esquerda",
  className = "",
  ...props
}: ComponentProps<"td"> & { alinhar?: "esquerda" | "direita" | "centro" }) {
  const al =
    alinhar === "direita"
      ? "text-right"
      : alinhar === "centro"
        ? "text-center"
        : "text-left";
  return (
    <td
      {...props}
      className={`px-3 py-2.5 text-[0.8125rem] text-[var(--p-texto)] ${al} ${className}`}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------- migalhas

/**
 * Caminho da investigação. Some do fluxo visual e reaparece quando a pessoa
 * precisa voltar um nível sem perder o recorte que a trouxe até aqui.
 */
export function Migalhas({
  itens,
}: {
  itens: { rotulo: string; href?: string }[];
}) {
  return (
    <nav aria-label="Caminho da análise" className="mb-3 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1.5 text-[0.75rem] text-[var(--p-fraco)]">
        {itens.map((item, indice) => (
          <li key={`${item.rotulo}-${indice}`} className="flex items-center gap-1.5">
            {indice > 0 ? <IconeSetaDireita tamanho={12} /> : null}
            {item.href ? (
              <Link className="hover:text-[var(--p-texto)]" href={item.href}>
                {item.rotulo}
              </Link>
            ) : (
              <span aria-current="page" className="text-[var(--p-suave)]">
                {item.rotulo}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
