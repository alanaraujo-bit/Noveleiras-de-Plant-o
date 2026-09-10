import type { SVGProps } from "react";

/** Conjunto de ícones do app: traço de 1,6 e cantos arredondados. */

type Props = SVGProps<SVGSVGElement> & { tamanho?: number };

function Base({ tamanho = 22, children, ...props }: Props) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconeCasa = (p: Props) => (
  <Base {...p}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 9.8V19a1 1 0 0 0 1 1h3.2v-4.4h3.6V20H17a1 1 0 0 0 1-1V9.8" />
  </Base>
);

export const IconeBusca = (p: Props) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.2" />
    <path d="m15.6 15.6 3.4 3.4" />
  </Base>
);

export const IconeFeed = (p: Props) => (
  <Base {...p}>
    <path d="M4 6.6A2.6 2.6 0 0 1 6.6 4h10.8A2.6 2.6 0 0 1 20 6.6v7.2a2.6 2.6 0 0 1-2.6 2.6H10l-4.2 3.4a.6.6 0 0 1-.98-.47V6.6Z" />
    <path d="M8.4 8.6h7.2M8.4 12h4.6" />
  </Base>
);

export const IconePerfil = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="8.4" r="3.6" />
    <path d="M5.2 20c.9-3.4 3.6-5.2 6.8-5.2s5.9 1.8 6.8 5.2" />
  </Base>
);

export const IconeCamera = (p: Props) => (
  <Base {...p}>
    <path d="M8.2 6.5 9.5 4.7h5l1.3 1.8h1.8A2.4 2.4 0 0 1 20 8.9v7.7a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 16.6V8.9a2.4 2.4 0 0 1 2.4-2.4h1.8Z" />
    <circle cx="12" cy="12.7" r="3.2" />
  </Base>
);

export const IconePlay = ({ tamanho = 22, ...p }: Props) => (
  <svg
    width={tamanho}
    height={tamanho}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
    focusable="false"
    {...p}
  >
    <path d="M8.4 5.3c0-.9 1-1.5 1.8-1l8 5.9c.7.5.7 1.6 0 2.1l-8 5.9c-.8.6-1.8 0-1.8-1V5.3Z" />
  </svg>
);

export const IconePausa = ({ tamanho = 22, ...p }: Props) => (
  <svg
    width={tamanho}
    height={tamanho}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
    focusable="false"
    {...p}
  >
    <rect x="6.6" y="4.6" width="3.8" height="14.8" rx="1.6" />
    <rect x="13.6" y="4.6" width="3.8" height="14.8" rx="1.6" />
  </svg>
);

export const IconeCoracao = ({
  preenchido = false,
  ...p
}: Props & { preenchido?: boolean }) => (
  <Base {...p} fill={preenchido ? "currentColor" : "none"}>
    <path d="M12 20s-7.2-4.3-7.2-9.3A4.2 4.2 0 0 1 12 8.2a4.2 4.2 0 0 1 7.2 2.5c0 5-7.2 9.3-7.2 9.3Z" />
  </Base>
);

export const IconeMais = (p: Props) => (
  <Base {...p}>
    <path d="M12 5.4v13.2M5.4 12h13.2" />
  </Base>
);

export const IconeCheck = (p: Props) => (
  <Base {...p}>
    <path d="m5 12.8 4.4 4.2L19 7" />
  </Base>
);

export const IconeCadeado = (p: Props) => (
  <Base {...p}>
    <rect x="4.8" y="10.4" width="14.4" height="9.4" rx="2.6" />
    <path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4" />
  </Base>
);

export const IconeVoltar = (p: Props) => (
  <Base {...p}>
    <path d="M14.4 5.2 7.6 12l6.8 6.8" />
  </Base>
);

export const IconeSeta = (p: Props) => (
  <Base {...p}>
    <path d="M9.6 5.2 16.4 12l-6.8 6.8" />
  </Base>
);

export const IconeFechar = (p: Props) => (
  <Base {...p}>
    <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />
  </Base>
);

export const IconeHistorico = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.6V12l3.2 2" />
  </Base>
);

export const IconeEstrela = ({
  preenchido = true,
  ...p
}: Props & { preenchido?: boolean }) => (
  <Base {...p} fill={preenchido ? "currentColor" : "none"} strokeWidth={1.2}>
    <path d="m12 4.4 2.32 4.9 5.28.72-3.86 3.6.96 5.18L12 16.3l-4.7 2.5.96-5.18L4.4 10.02l5.28-.72L12 4.4Z" />
  </Base>
);

export const IconeVolume = ({
  mudo = false,
  ...p
}: Props & { mudo?: boolean }) => (
  <Base {...p}>
    <path d="M4.8 9.6h2.6L11.4 6v12l-4-3.6H4.8z" />
    {mudo ? (
      <path d="m15 9.6 4.2 4.8M19.2 9.6 15 14.4" />
    ) : (
      <path d="M15.2 9.2a4 4 0 0 1 0 5.6M17.8 6.8a7.4 7.4 0 0 1 0 10.4" />
    )}
  </Base>
);

export const IconeTelaCheia = ({
  ativa = false,
  ...p
}: Props & { ativa?: boolean }) => (
  <Base {...p}>
    {ativa ? (
      <>
        <path d="M9.2 4.8v4.4H4.8M14.8 4.8v4.4h4.4M9.2 19.2v-4.4H4.8M14.8 19.2v-4.4h4.4" />
      </>
    ) : (
      <>
        <path d="M9.2 4.8H4.8v4.4M14.8 4.8h4.4v4.4M9.2 19.2H4.8v-4.4M14.8 19.2h4.4v-4.4" />
      </>
    )}
  </Base>
);

export const IconeCompartilhar = (p: Props) => (
  <Base {...p}>
    <path d="M12 15.4V4.6M8.6 7.8 12 4.4l3.4 3.4" />
    <path d="M6 12.4H5.4A1.4 1.4 0 0 0 4 13.8v4.8A1.4 1.4 0 0 0 5.4 20h13.2a1.4 1.4 0 0 0 1.4-1.4v-4.8a1.4 1.4 0 0 0-1.4-1.4H18" />
  </Base>
);

export const IconeConversa = (p: Props) => (
  <Base {...p}>
    <path d="M20 12.2c0 3.7-3.6 6.7-8 6.7a9 9 0 0 1-2.4-.32L5.2 20l.9-3.2A6.4 6.4 0 0 1 4 12.2C4 8.5 7.6 5.5 12 5.5s8 3 8 6.7Z" />
  </Base>
);

export const IconeOlho = ({
  fechado = false,
  ...p
}: Props & { fechado?: boolean }) => (
  <Base {...p}>
    <path d="M2.8 12S6.4 6.2 12 6.2 21.2 12 21.2 12 17.6 17.8 12 17.8 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.6" />
    {fechado ? <path d="m4.4 19.6 15.2-15.2" /> : null}
  </Base>
);

export const IconeInstalar = (p: Props) => (
  <Base {...p}>
    <rect x="6.6" y="3" width="10.8" height="18" rx="2.6" />
    <path d="M12 8v6M9.4 11.4 12 14l2.6-2.6" />
  </Base>
);

export const IconeProximo = ({ tamanho = 22, ...p }: Props) => (
  <svg
    width={tamanho}
    height={tamanho}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
    focusable="false"
    {...p}
  >
    <path d="M6.4 5.6c0-.8.9-1.3 1.6-.9l8.2 5.5c.6.4.6 1.3 0 1.7L8 17.4c-.7.4-1.6 0-1.6-.9V5.6Z" />
    <rect x="17.2" y="4.8" width="2.2" height="14.4" rx="1.1" />
  </svg>
);

/**
 * Aba do reel: uma lâmina vertical com o triângulo de play.
 *
 * Não reaproveita a casinha porque as duas abas passaram a competir: a casa
 * agora é o catálogo, e dois ícones de "início" na mesma barra deixariam a
 * pessoa sem saber qual leva ao vídeo.
 */
export const IconePlantao = ({
  ativo = false,
  ...p
}: Props & { ativo?: boolean }) => (
  <Base {...p}>
    <rect
      x="6.4"
      y="3.4"
      width="11.2"
      height="17.2"
      rx="3"
      fill={ativo ? "currentColor" : "none"}
      opacity={ativo ? 0.16 : 1}
    />
    <rect x="6.4" y="3.4" width="11.2" height="17.2" rx="3" />
    <path
      d="M10.7 9.3a.6.6 0 0 1 .92-.5l3.1 1.9a.6.6 0 0 1 0 1.02l-3.1 1.9a.6.6 0 0 1-.92-.5V9.3Z"
      fill="currentColor"
      stroke="none"
    />
  </Base>
);

/** Aba do catálogo: a grade de cartazes. */
export const IconeCatalogo = (p: Props) => (
  <Base {...p}>
    <rect x="3.6" y="4.2" width="7" height="7" rx="1.8" />
    <rect x="13.4" y="4.2" width="7" height="7" rx="1.8" />
    <rect x="3.6" y="12.8" width="7" height="7" rx="1.8" />
    <rect x="13.4" y="12.8" width="7" height="7" rx="1.8" />
  </Base>
);

/** Coração cheio da curtida — traço mais grosso para segurar sobre vídeo. */
export const IconeCoracaoCheio = ({ tamanho = 22, ...p }: Props) => (
  <svg
    width={tamanho}
    height={tamanho}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
    focusable="false"
    {...p}
  >
    <path d="M12 21.2c-.4 0-.8-.14-1.1-.42C7.3 17.6 3 14 3 9.9 3 6.9 5.3 4.6 8.2 4.6c1.5 0 2.9.66 3.8 1.76a5 5 0 0 1 3.8-1.76C18.7 4.6 21 6.9 21 9.9c0 4.1-4.3 7.7-7.9 10.88-.3.28-.7.42-1.1.42Z" />
  </svg>
);

export const IconeMarca = ({ tamanho = 28, ...p }: Props) => (
  <svg
    width={tamanho}
    height={tamanho}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden
    focusable="false"
    {...p}
  >
    <path
      d="M6 26V6.8c0-.6.7-.9 1.2-.5l14.4 12.4V6.6a1 1 0 0 1 2 0V26"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
    />
    <circle cx="24.6" cy="8.4" r="2.6" fill="currentColor" />
  </svg>
);
