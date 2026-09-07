import type { SVGProps } from "react";

/**
 * Ícones do painel.
 *
 * Mesmo traço do aplicativo (1,6 em caixa de 24, pontas arredondadas) para que
 * as duas metades do produto pareçam desenhadas pela mesma mão. Ficam num
 * arquivo próprio porque são vocabulário de operação — servidor, fila, log —
 * que a interface do assinante nunca vai usar.
 */

type Props = SVGProps<SVGSVGElement> & { tamanho?: number };

function Base({ tamanho = 18, children, ...props }: Props) {
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

export const IconePainel = (p: Props) => (
  <Base {...p}>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <path d="M12 13 15.5 9.5" />
    <path d="M4 13v3.5h16V13" />
  </Base>
);

export const IconeUsuarios = (p: Props) => (
  <Base {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.4-3 2.7-4.8 5.5-4.8s5.1 1.8 5.5 4.8" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 5.9" />
    <path d="M17.6 14.9c2 .5 3.4 2.2 3.7 4.6" />
  </Base>
);

export const IconeStreaming = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M10.4 8.8v6.4l5-3.2z" />
  </Base>
);

export const IconeCatalogo = (p: Props) => (
  <Base {...p}>
    <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16 8.5 4.5 8.5-4.5" />
  </Base>
);

export const IconeMidia = (p: Props) => (
  <Base {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
    <path d="M3 9h18M8 4.5v4.5M16 4.5v4.5" />
    <path d="M10.6 12.6v4l3.6-2z" />
  </Base>
);

export const IconeServidor = (p: Props) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="6.5" rx="1.8" />
    <rect x="3" y="13.5" width="18" height="6.5" rx="1.8" />
    <path d="M6.8 7.2h.01M6.8 16.8h.01" />
    <path d="M11 7.2h4M11 16.8h4" />
  </Base>
);

export const IconeTranscode = (p: Props) => (
  <Base {...p}>
    <rect x="7.5" y="7.5" width="9" height="9" rx="1.6" />
    <path d="M10 3.5v4M14 3.5v4M10 16.5v4M14 16.5v4" />
    <path d="M3.5 10h4M3.5 14h4M16.5 10h4M16.5 14h4" />
  </Base>
);

export const IconeFinanceiro = (p: Props) => (
  <Base {...p}>
    <rect x="2.8" y="5.5" width="18.4" height="13" rx="2.2" />
    <path d="M2.8 10h18.4" />
    <path d="M6.5 14.5h3.5" />
  </Base>
);

export const IconeComunidade = (p: Props) => (
  <Base {...p}>
    <path d="M20 13.5c0 2.5-2.6 4.5-6 4.5-.9 0-1.8-.1-2.5-.4L7 19.5l1.2-2.6C6.8 16 6 14.8 6 13.5 6 11 8.6 9 12 9s8 2 8 4.5z" />
    <path d="M6.6 9.7C5 9 4 7.8 4 6.4 4 4.5 6.2 3 9 3c2.4 0 4.4 1.1 4.9 2.6" />
  </Base>
);

export const IconeBuscaPainel = (p: Props) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.2" />
    <path d="m15.6 15.6 3.4 3.4" />
  </Base>
);

export const IconeLogs = (p: Props) => (
  <Base {...p}>
    <path d="M5 4.5h14M5 9h14M5 13.5h9M5 18h6" />
  </Base>
);

export const IconeAuditoria = (p: Props) => (
  <Base {...p}>
    <path d="M12 3.2 19.5 6v5.6c0 4.2-3 7.3-7.5 9.2-4.5-1.9-7.5-5-7.5-9.2V6z" />
    <path d="m9 11.8 2.2 2.2 4-4.2" />
  </Base>
);

export const IconeAlertas = (p: Props) => (
  <Base {...p}>
    <path d="M12 4.2 21 19.5H3z" />
    <path d="M12 10v4M12 16.8h.01" />
  </Base>
);

export const IconeAdmin = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8" />
  </Base>
);

export const IconeSaida = (p: Props) => (
  <Base {...p}>
    <path d="M14.5 4.5H6.8A1.8 1.8 0 0 0 5 6.3v11.4a1.8 1.8 0 0 0 1.8 1.8h7.7" />
    <path d="M15.5 8.5 19 12l-3.5 3.5M19 12h-9" />
  </Base>
);

export const IconeCalendario = (p: Props) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Base>
);

export const IconeSubindo = (p: Props) => (
  <Base {...p}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </Base>
);

export const IconeDescendo = (p: Props) => (
  <Base {...p}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </Base>
);

export const IconeEstavel = (p: Props) => (
  <Base {...p}>
    <path d="M5 12h14" />
  </Base>
);

export const IconeAtualizar = (p: Props) => (
  <Base {...p}>
    <path d="M20 11.5A8 8 0 1 0 18.4 17" />
    <path d="M20.5 5.5V11h-5.5" />
  </Base>
);

export const IconeAbrir = (p: Props) => (
  <Base {...p}>
    <path d="M13.5 4.5H19.5V10.5" />
    <path d="M19.5 4.5 11 13" />
    <path d="M18.5 14v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V7.3a1.8 1.8 0 0 1 1.8-1.8H10" />
  </Base>
);

export const IconeMenu = (p: Props) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);

export const IconeFecharPainel = (p: Props) => (
  <Base {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Base>
);

export const IconeFiltro = (p: Props) => (
  <Base {...p}>
    <path d="M3.5 5.5h17l-6.6 7.6v5.6l-3.8 2v-7.6z" />
  </Base>
);

export const IconeAviso = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.8v4.6M12 15.8h.01" />
  </Base>
);

export const IconeOk = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="m8.4 12.2 2.4 2.4 4.8-5" />
  </Base>
);

export const IconeSetaDireita = (p: Props) => (
  <Base {...p}>
    <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
  </Base>
);

export const IconeVoltarPainel = (p: Props) => (
  <Base {...p}>
    <path d="M19 12H6M11 6.5 5.5 12l5.5 5.5" />
  </Base>
);
