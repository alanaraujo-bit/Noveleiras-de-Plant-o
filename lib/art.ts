/**
 * Arte gerada.
 *
 * O catálogo de demonstração não tem fotografia. Em vez de retângulos cinzas,
 * cada novela recebe uma capa abstrata determinística — desenhada a partir do
 * slug e da cor da obra, no espírito de cartaz de folhetim. O título nunca é
 * gravado na imagem: vem em HTML por cima, nítido e acessível.
 *
 * Quando houver arte real, `posterKey` deixa de começar com "gen:" e este
 * módulo simplesmente para de ser chamado.
 */

export type ArtShape = "cortina" | "arcos" | "luas" | "ondas";

export type ArtSpec = {
  width: number;
  height: number;
  accent: string;
  shape: ArtShape;
  /** 0..1 — desloca o foco de luz. */
  focus: number;
  rotation: number;
  seed: number;
};

const SHAPES: ArtShape[] = ["cortina", "arcos", "luas", "ondas"];

export function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export type ArtFormat = "capa" | "hero" | "cena";

const SIZES: Record<ArtFormat, { width: number; height: number }> = {
  capa: { width: 720, height: 1080 },
  hero: { width: 900, height: 1200 },
  cena: { width: 960, height: 540 },
};

export function artSpec(
  format: ArtFormat,
  key: string,
  accent: string,
): ArtSpec {
  const seed = hashKey(key);
  const { width, height } = SIZES[format];
  return {
    width,
    height,
    accent,
    shape: SHAPES[seed % SHAPES.length],
    focus: ((seed >> 5) % 100) / 100,
    rotation: ((seed >> 9) % 24) - 12,
    seed,
  };
}

function mix(hex: string, target: string, amount: number): string {
  const parse = (value: string) => {
    const clean = value.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  };
  const a = parse(hex);
  const b = parse(target);
  const out = a.map((channel, i) =>
    Math.round(channel + (b[i] - channel) * amount),
  );
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const INK = "#130810";
const GOLD = "#e9bd78";

/**
 * Cada motivo devolve duas camadas: `massa` (formas amplas, desfocadas, que
 * dão profundidade) e `traco` (linhas nítidas por cima, que dão desenho). Sem
 * a segunda camada a arte vira mancha; sem a primeira, vira wireframe.
 */
type Camadas = { massa: string; traco: string };

function motif(spec: ArtSpec): Camadas {
  const { width: w, height: h, seed, accent } = spec;
  const claro = mix(accent, "#ffffff", 0.45);
  const brilho = mix(accent, "#ffffff", 0.72);

  switch (spec.shape) {
    // Cortina de teatro: pregas verticais e a barra do proscênio.
    case "cortina": {
      const pregas = 6 + (seed % 3);
      const passo = w / pregas;
      let massa = "";
      let traco = "";
      for (let i = 0; i <= pregas; i += 1) {
        const x = i * passo;
        const curva = ((seed >> (i + 2)) % 46) - 23;
        massa += `<path d="M${x} -30 C ${x + curva} ${h * 0.34}, ${x - curva} ${h * 0.72}, ${x + curva / 2} ${h + 30}" stroke="${claro}" stroke-width="${(passo * 0.62).toFixed(1)}" fill="none" opacity="${(0.1 + ((seed >> i) % 9) / 45).toFixed(3)}" stroke-linecap="round"/>`;
        traco += `<path d="M${x + curva / 3} -30 C ${x + curva} ${h * 0.34}, ${x - curva} ${h * 0.72}, ${x + curva / 2} ${h + 30}" stroke="${brilho}" stroke-width="1.4" fill="none" opacity="${(0.18 + ((seed >> (i + 1)) % 5) / 20).toFixed(3)}"/>`;
      }
      traco += `<rect x="0" y="${(h * 0.12).toFixed(0)}" width="${w}" height="2" fill="${GOLD}" opacity="0.3"/>`;
      return { massa, traco };
    }

    // Arcos concêntricos: o proscênio visto de frente.
    case "arcos": {
      let massa = "";
      let traco = "";
      const cx = w * 0.5;
      const cy = h * 0.74;
      for (let i = 0; i < 7; i += 1) {
        const r = w * (0.26 + i * 0.17);
        massa += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${claro}" stroke-width="${(w * 0.055).toFixed(1)}" opacity="${(0.11 - i * 0.012).toFixed(3)}"/>`;
        traco += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${i % 3 === 0 ? GOLD : brilho}" stroke-width="${(1.6 - i * 0.12).toFixed(2)}" opacity="${(0.42 - i * 0.05).toFixed(3)}"/>`;
      }
      return { massa, traco };
    }

    // Luas: discos sobrepostos, clima de madrugada.
    case "luas": {
      let massa = "";
      let traco = "";
      for (let i = 0; i < 4; i += 1) {
        const cx = w * (0.18 + ((seed >> (i * 3)) % 64) / 100);
        const cy = h * (0.14 + i * 0.21);
        const r = w * (0.15 + ((seed >> i) % 24) / 100);
        massa += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${i === 1 ? GOLD : claro}" opacity="${(0.14 + i * 0.02).toFixed(3)}"/>`;
        traco += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${i === 1 ? GOLD : brilho}" stroke-width="1.3" opacity="0.4"/>`;
      }
      return { massa, traco };
    }

    // Ondas: horizonte de mar, para as histórias de água e recomeço.
    default: {
      let massa = "";
      let traco = "";
      for (let i = 0; i < 6; i += 1) {
        const y = h * (0.34 + i * 0.105);
        const amp = 20 + ((seed >> i) % 34);
        const d = `M-30 ${y.toFixed(1)} Q ${w * 0.26} ${(y - amp).toFixed(1)}, ${w * 0.5} ${y.toFixed(1)} T ${w + 30} ${y.toFixed(1)}`;
        massa += `<path d="${d}" stroke="${claro}" stroke-width="${(h * 0.03).toFixed(1)}" fill="none" opacity="${(0.12 - i * 0.012).toFixed(3)}"/>`;
        traco += `<path d="${d}" stroke="${i === 2 ? GOLD : brilho}" stroke-width="${(1.8 - i * 0.15).toFixed(2)}" fill="none" opacity="${(0.45 - i * 0.055).toFixed(3)}"/>`;
      }
      return { massa, traco };
    }
  }
}

/** SVG completo, pronto para servir como imagem. */
export function renderArt(spec: ArtSpec): string {
  const { width: w, height: h, accent, focus } = spec;
  const deep = mix(accent, INK, 0.72);
  const mid = mix(accent, INK, 0.38);
  const lightX = (18 + focus * 64).toFixed(1);
  const { massa, traco } = motif(spec);

  // Miniaturas de cena vivem sob texto curto: pedem menos véu que os cartazes.
  const veuFinal = h > w ? 0.72 : 0.45;
  const veuInicio = h > w ? 0.42 : 0.5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
<defs>
<linearGradient id="base" x1="0" y1="0" x2="0.4" y2="1">
<stop offset="0" stop-color="${mid}"/>
<stop offset="0.5" stop-color="${deep}"/>
<stop offset="1" stop-color="${INK}"/>
</linearGradient>
<radialGradient id="glow" cx="${lightX}%" cy="14%" r="70%">
<stop offset="0" stop-color="${accent}" stop-opacity="0.6"/>
<stop offset="0.45" stop-color="${accent}" stop-opacity="0.16"/>
<stop offset="1" stop-color="${accent}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="feixe" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.09"/>
<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</linearGradient>
<linearGradient id="veil" x1="0" y1="${veuInicio}" x2="0" y2="1">
<stop offset="0" stop-color="${INK}" stop-opacity="0"/>
<stop offset="1" stop-color="${INK}" stop-opacity="${veuFinal}"/>
</linearGradient>
<filter id="soft"><feGaussianBlur stdDeviation="${(w * 0.014).toFixed(1)}"/></filter>
<filter id="grao"><feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" result="n"/><feColorMatrix in="n" type="saturate" values="0"/></filter>
</defs>
<rect width="${w}" height="${h}" fill="url(#base)"/>
<g transform="rotate(${spec.rotation} ${w / 2} ${h / 2})">
<g filter="url(#soft)">${massa}</g>
${traco}
</g>
<rect width="${w}" height="${h}" fill="url(#glow)"/>
<rect x="${-w * 0.3}" y="${-h * 0.1}" width="${w * 0.55}" height="${h * 1.4}" fill="url(#feixe)" transform="rotate(18 ${w / 2} ${h / 2})"/>
<rect width="${w}" height="${h}" fill="url(#veil)"/>
<rect width="${w}" height="${h}" filter="url(#grao)" opacity="0.07" style="mix-blend-mode:overlay"/>
</svg>`;
}
