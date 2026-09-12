/**
 * O vocabulário da origem, traduzido para o do produto.
 *
 * O manifesto traz os temas crus do ReelShort — `{ key, value, group }` —
 * exatamente como o contrato manda: sem traduzir e sem inventar gênero. Este
 * arquivo é o outro lado desse contrato: a decisão editorial de o que cada
 * tema significa aqui dentro.
 *
 * ## O que o `group` resolve
 *
 * A origem manda tudo na mesma lista: "Bilionário", "Mansão", "Meg Bush" e
 * "Todas as Idades" chegam juntos. Sem o grupo, `tags` receberia nome de
 * atriz, classificação indicativa e país misturados com enredo — e a busca
 * por "tema" devolveria novela por causa do país. O grupo separa isso na
 * entrada, uma vez, em vez de espalhar exceções por todas as telas.
 *
 * Os grupos observados na biblioteca (4.806 temas, 228 novelas):
 *
 * | grupo     | o que é                  | exemplos                        |
 * |-----------|--------------------------|---------------------------------|
 * | 1000      | público                  | Feminina, Masculino, LGBTQ+     |
 * | 1001/1005 | elenco                   | Marc Herrmann, Meg Bush         |
 * | 1010      | gênero da origem         | Romance, Drama, Animação        |
 * | 1010001   | subgênero                | Romance Doce, Heroína Forte     |
 * | 1011      | mundo                    | Moderno, Fantasia, Máfia        |
 * | 1012      | tom                      | Romântico, Escuro, Emocional    |
 * | 1013      | país                     | Estados Unidos, China           |
 * | 1014      | época                    | Contemporâneo, Futuro           |
 * | 1015      | classificação indicativa | Todas as Idades, Só para adultos|
 * | 1020      | papéis                   | CEO, Lobisomem, Mãe Solteira    |
 * | 1022      | enredo                   | Vingança, Gravidez, Segredo     |
 * | 1023      | lugar                    | Mansão, Escritório, Hospital    |
 * | 1024      | acontecimentos           | Divórcio, Assassinato           |
 *
 * ## Idioma
 *
 * A origem responde no idioma da página pedida, e a biblioteca tem manifestos
 * das duas épocas: 37 temas chegam ora em inglês, ora em português, com a
 * **mesma** `key`. Como nem todo manifesto traz as duas formas, a normalização
 * é por texto, não por id — uma tabela pequena e legível, que também serve de
 * documentação do que a origem chama de quê.
 */

// O tipo vem de quem lê o disco. A seta aponta para cá — a leitura não sabe
// o que os temas significam —, e `biblioteca.ts` precisa continuar sem
// importar nada para caber no agente de bandeja.
import type { TemaDaOrigem } from "./biblioteca.ts";

export type { TemaDaOrigem };

const GRUPO = {
  publico: "1000",
  publicoSub: "1000001",
  elencoMasculino: "1001",
  elencoFeminino: "1005",
  genero: "1010",
  subgenero: "1010001",
  mundo: "1011",
  tom: "1012",
  pais: "1013",
  epoca: "1014",
  classificacao: "1015",
  papel: "1020",
  enredo: "1022",
  lugar: "1023",
  acontecimento: "1024",
} as const;

/** Grupos cujo texto descreve a história. É daqui que saem tags e gêneros. */
const GRUPOS_DE_ENREDO: string[] = [
  GRUPO.subgenero,
  GRUPO.mundo,
  GRUPO.tom,
  GRUPO.papel,
  GRUPO.enredo,
  GRUPO.lugar,
  GRUPO.acontecimento,
];

/** Inglês → português, para os temas que a origem manda nos dois idiomas. */
const TRADUCAO: Record<string, string> = {
  "Adventure": "Aventura",
  "Age Gap": "Diferença de Idade",
  "All Ages": "Todas as Idades",
  "Assistant": "Assistente",
  "Competition": "Competição",
  "Contemporary": "Contemporâneo",
  "Dark Romance": "Romance Sombrio",
  "Enemies to Lovers": "Inimigos para Amantes",
  "Fantasy": "Fantasia",
  "Female": "Feminina",
  "Forbidden Love": "Amor Proibido",
  "Future": "Futuro",
  "Gritty": "Cru",
  "Hot Daddy/DILF": "Papai Gostoso/DILF",
  "Househusband": "Dono de casa",
  "Independent Woman": "Mulher Independente",
  "Intimate": "Íntimo",
  "Mansion": "Mansão",
  "Misunderstanding": "Mal-entendido",
  "Modern": "Moderno",
  "Office": "Escritório",
  "Office Romance": "Romance no Escritório",
  "Possessive": "Possessivo",
  "Post-Apocalyptic": "Pós-apocalíptico",
  "Romantic": "Romântico",
  "Sabotaging": "Sabotagem",
  "Sci-Fi": "Ficção Científica",
  "Scientist": "Cientista",
  "Self-growth": "Autodesenvolvimento",
  "Street": "Rua",
  "Strong-Willed": "Determinado / Determinada",
  "Super Power": "Superpoder",
  "Super Warrior": "Super Guerreiro",
  "Survival": "Sobrevivência",
  "Survivor": "Sobrevivente",
  "USA": "Estados Unidos",
  "Viral Plague": "Praga Viral",
  "Workplace": "Local de trabalho",
};

/** Países da origem, no nome que o catálogo usa. */
const PAIS: Record<string, string> = {
  "Estados Unidos": "Estados Unidos",
  "América do Norte": "Estados Unidos",
  "China": "China",
  "Europa": "Europa",
  "Reino Unido": "Reino Unido",
};

/**
 * Tags que não descrevem a história e por isso não viram tag do catálogo.
 *
 * "Moderno" e "Contemporâneo" estão em metade da biblioteca; "Tudo" e
 * "Clássico" não dizem nada sobre a obra. Uma tag que não separa uma novela da
 * outra só ocupa espaço na ficha e engana a busca.
 */
const TAGS_QUE_NAO_DIZEM_NADA = new Set([
  "Moderno",
  "Contemporâneo",
  "Clássico",
  "Tudo",
  "Conjunto",
  "Todas as Idades",
]);

export type GeneroDoCatalogo = {
  slug: string;
  name: string;
  tagline: string;
  accent: string;
};

/**
 * Os gêneros do produto.
 *
 * A lista saiu da biblioteca real, não de uma ideia do que uma novela costuma
 * ser: cada um destes tem obra suficiente para virar um filtro que vale a pena
 * tocar. É a mesma lista que o seed usa, para o catálogo de demonstração e o
 * importado falarem a mesma língua.
 *
 * **A ordem vai do mais específico ao mais genérico**, e isso é uma regra de
 * produto, não arrumação: é ela que decide qual gênero representa a novela no
 * cartão quando a obra tem três. Quase todo folhetim aqui tem um CEO e alguém
 * se vingando; quase nenhum tem lobisomem. Apresentar "Lágrimas de um Vampiro"
 * como "Herança & Poder" é verdade e não diz nada — "Alcateia & Sobrenatural"
 * é o que faz alguém reconhecer a história.
 */
export const GENEROS: GeneroDoCatalogo[] = [
  {
    slug: "alcateia-e-sobrenatural",
    name: "Alcateia & Sobrenatural",
    tagline: "Alfa, luna e presas à mostra",
    accent: "#7A5BD0",
  },
  {
    slug: "amores-de-campus",
    name: "Amores de Campus",
    tagline: "Amor com prova na segunda",
    accent: "#3FA9C9",
  },
  {
    slug: "casamento-de-contrato",
    name: "Casamento de Contrato",
    tagline: "Assinaram primeiro, amaram depois",
    accent: "#C9748E",
  },
  {
    slug: "suspense-passional",
    name: "Suspense Passional",
    tagline: "Amar aqui é assumir risco",
    accent: "#4F7CC4",
  },
  {
    slug: "reencontro",
    name: "Reencontro",
    tagline: "Dez anos depois, no mesmo elevador",
    accent: "#E9BD78",
  },
  {
    slug: "segundo-amor",
    name: "Segundo Amor",
    tagline: "Quando a primeira vida acaba",
    accent: "#5FC79B",
  },
  {
    slug: "segredos-de-familia",
    name: "Segredos de Família",
    tagline: "Todo álbum tem uma foto arrancada",
    accent: "#8E6BC4",
  },
  {
    slug: "romance-no-trabalho",
    name: "Romance no Trabalho",
    tagline: "O que acontece na sala fica na sala",
    accent: "#9AA3B5",
  },
  {
    slug: "inimigos-para-amantes",
    name: "Inimigos para Amantes",
    tagline: "Do ódio ao amor, dois passos",
    accent: "#E06A3A",
  },
  {
    slug: "romance-proibido",
    name: "Romance Proibido",
    tagline: "O que não devia acontecer — e acontece",
    accent: "#E03A69",
  },
  {
    slug: "comedia-romantica",
    name: "Comédia Romântica",
    tagline: "Para rir de vergonha alheia com carinho",
    accent: "#F2648C",
  },
  {
    slug: "virada-de-vida",
    name: "Virada de Vida",
    tagline: "Ela sobe — e ninguém segura",
    accent: "#4FB3A5",
  },
  {
    slug: "vinganca",
    name: "Vingança",
    tagline: "Elas voltaram. E lembram de tudo",
    accent: "#A01F45",
  },
  {
    slug: "heranca-e-poder",
    name: "Herança & Poder",
    tagline: "Sobrenome pesa mais que sentimento",
    accent: "#D9A355",
  },
];

/**
 * Peso de cada tema dentro de um gênero.
 *
 * O peso é o quanto aquele tema **aponta** para o gênero, não o quanto ele é
 * comum: "Lobisomem" vale 4 porque uma novela com lobisomem é uma novela de
 * alcateia, enquanto "Mansão" vale 1 porque mansão aparece em qualquer
 * história de dinheiro. Só entra tema que separa uma obra da outra — por isso
 * "Revelação de Identidade", presente em quase metade da biblioteca, não
 * pontua em lugar nenhum.
 */
const PESOS: Record<string, Record<string, number>> = {
  vinganca: {
    "Vingança": 4,
    "Dando o troco no ex": 4,
    "Karma": 3,
    "Sabotagem": 2,
    "Pego Trapaceando": 2,
    "Tarde Demais": 2,
    "Fazendo-se de bobo": 2,
    "Lamentável": 1,
  },
  "heranca-e-poder": {
    "Bilionário": 3,
    "CEO": 3,
    "CEO durão": 3,
    "Herdeira/Socialite": 3,
    "Realeza/Nobreza": 3,
    "Proprietário de Negócio": 2,
    "Negócios": 1,
    "Mansão": 1,
    "Castelo": 1,
    "Palácio": 1,
    "Playboy": 1,
    "Banquete": 1,
  },
  "alcateia-e-sobrenatural": {
    "Lobisomem": 4,
    "Alfa": 4,
    "Luna": 4,
    "Vampiro": 4,
    "Ataque de Lobisomem": 3,
    "Ataque de Vampiro": 3,
    "Dragão": 3,
    "Imortal": 3,
    "Sobrenatural": 3,
    "Magia": 3,
    "Superpoder": 2,
    "Super Guerreiro": 2,
    "O Escolhido": 2,
    "Renascimento": 2,
    "Reencarnação": 2,
    "Curandeiro": 1,
    "Fantasia": 1,
  },
  "casamento-de-contrato": {
    "Casamento Relâmpago": 4,
    "Amantes Contratados": 4,
    "Noiva Substituta": 3,
    "Relacionamento Falso": 3,
    "Amor Após o Casamento": 3,
    "Marido Protetor": 2,
    "Gravidez Falsa": 2,
    "Casamento": 1,
  },
  "virada-de-vida": {
    "Poder Feminino": 3,
    "Mulher Independente": 3,
    "Heroína Forte": 3,
    "História de Superação": 3,
    "Da Pobreza à Riqueza": 3,
    "Transformação": 3,
    "Empoderamento Feminino": 3,
    "Autodesenvolvimento": 2,
    "Azarão": 2,
    "Lute contra o sistema": 2,
    "Determinado / Determinada": 1,
  },
  "inimigos-para-amantes": {
    "Inimigos para Amantes": 4,
    "Amor e Ódio": 4,
    "Competição": 1,
    "Mal-entendido": 1,
    "Triângulo Amoroso": 1,
  },
  "comedia-romantica": {
    "Leve e divertido": 4,
    "Engraçado": 4,
    "Bobo": 3,
    "Excêntrico": 2,
    "Despreocupado": 2,
    "Os opostos se atraem.": 2,
    "Romance Doce": 1,
    "Encantador": 1,
  },
  "segredos-de-familia": {
    "Filho Secreto": 4,
    "Revelação da Criança Perdida": 4,
    "Criança Perdida": 3,
    "Revelação da Identidade dos Pais": 3,
    "Família Disfuncional": 3,
    "Bebês Geniais": 3,
    "Gravidez": 2,
    "Bebê": 2,
    "Drama Familiar": 2,
    "Mãe e Filha": 1,
    "Mãe e Filho": 1,
    "Pai e Filha": 1,
    "Pai e Filho": 1,
    "Meio-irmãos": 1,
    "Gêmeos": 1,
  },
  reencontro: {
    "Reencontro Anos Depois": 4,
    "Encontrar novamente": 4,
    "Amantes Reunidos": 4,
    "Reunião": 3,
    "Reunião como Estranhos": 3,
    "Amor de Infância": 2,
    "Retorno": 2,
    "Primeiro Amor": 1,
    "Amnésia": 1,
  },
  "suspense-passional": {
    "Cheio de suspense": 3,
    "Romance Sombrio": 3,
    "Assassinato": 3,
    "Conspiração": 3,
    "Chefe do Crime": 3,
    "Máfia": 3,
    "Amor & Crime": 3,
    "Suspense": 3,
    "Escuro": 2,
    "Psicológico": 2,
    "Violento": 2,
    "Criminoso": 2,
    "Gângster": 2,
    "Assassino": 2,
  },
  "amores-de-campus": {
    "Amores do Campus": 4,
    "Campus": 3,
    "Estudante": 2,
    "Jovem Adulto": 2,
    "Adolescente": 2,
    "Jock": 2,
    "Academia": 2,
    "Atleta": 1,
  },
  "romance-proibido": {
    "Amor Proibido": 4,
    "Tabu": 3,
    "Caso": 3,
    "Amante Secreto": 3,
    "Romance Secreto no Escritório": 3,
    "Romance Tóxico": 2,
    "Diferença de Idade": 2,
    "Despertar Sexual": 2,
    "BDSM": 2,
    "Erótica": 2,
    "Possessivo": 1,
    "Quente": 1,
    "Íntimo": 1,
  },
  "segundo-amor": {
    "Divórcio": 4,
    "Amor Após o Divórcio": 4,
    "Segunda Chance": 4,
    "Término": 3,
    "Término de Noivado": 3,
    "Mãe Solteira": 3,
    "Pai Solteiro": 3,
  },
  "romance-no-trabalho": {
    "Romance no Escritório": 4,
    "Escritório": 2,
    "Local de trabalho": 2,
    "Trabalhador de Escritório": 2,
    "Assistente": 2,
    "Estagiário": 2,
    "Hospital": 1,
    "Médico/Cirurgião": 1,
  },
};

/**
 * Nota mínima para a novela entrar num gênero.
 *
 * Quatro é um tema forte sozinho ("Lobisomem") ou dois fracos juntos. Abaixo
 * disso, um único tema periférico colocaria a obra num filtro onde quem
 * abrisse não reconheceria a história.
 */
const NOTA_MINIMA = 4;

/**
 * Gêneros por novela. Três é o que cabe numa ficha sem virar lista, e obriga
 * a classificação a escolher o que a obra realmente é.
 */
const MAX_GENEROS = 3;

/** Classificação indicativa: só a origem que declara conteúdo adulto muda. */
const CLASSIFICACAO: Record<string, string> = {
  "Somente para adultos": "18",
};

export type Classificacao = {
  /** Nomes do elenco, na ordem em que a origem mandou. */
  elenco: string[];
  /** Temas de enredo, já em português e sem os que não dizem nada. */
  tags: string[];
  /** Slugs dos gêneros, do mais forte para o mais fraco. */
  generos: string[];
  /** País de produção, quando a origem declara. */
  pais: string | null;
  /** Classificação indicativa, quando a origem declara conteúdo adulto. */
  classificacao: string | null;
};

function traduzir(valor: string): string {
  return TRADUCAO[valor] ?? valor;
}

/**
 * Os nomes do elenco na forma que a ficha guarda.
 *
 * O papel vai vazio porque a origem não diz qual personagem cada um faz.
 * Preencher com "Elenco" seria repetir o título da seção embaixo de cada nome,
 * e escrever "Protagonista" seria inventar. A ficha simplesmente não mostra
 * papel quando não há papel.
 */
export function paraElenco(nomes: string[]): { name: string; role: string }[] {
  return nomes.map((name) => ({ name, role: "" }));
}

/**
 * Lê os temas crus de uma novela e devolve o que o catálogo grava.
 *
 * Manifesto antigo, sem `grupo`, cai no caminho conservador: os temas viram
 * tags, como já era, e nada além disso é deduzido. Chutar o grupo pelo texto
 * colocaria nome de atriz em tag de enredo.
 */
export function classificarTemas(temas: TemaDaOrigem[]): Classificacao {
  const elenco: string[] = [];
  const tags: string[] = [];
  const vistos = new Set<string>();
  let pais: string | null = null;
  let classificacao: string | null = null;

  for (const tema of temas) {
    const valor = traduzir(tema.valor.trim());
    if (!valor) continue;

    if (
      tema.grupo === GRUPO.elencoMasculino ||
      tema.grupo === GRUPO.elencoFeminino
    ) {
      if (!elenco.includes(valor)) elenco.push(valor);
      continue;
    }

    if (tema.grupo === GRUPO.pais) {
      pais = pais ?? PAIS[valor] ?? null;
      continue;
    }

    if (tema.grupo === GRUPO.classificacao) {
      classificacao = classificacao ?? CLASSIFICACAO[valor] ?? null;
      continue;
    }

    // Público (1000) e época (1014) descrevem para quem é e quando se passa,
    // não do que a novela trata. Ficam de fora das tags de propósito.
    if (
      tema.grupo === GRUPO.publico ||
      tema.grupo === GRUPO.publicoSub ||
      tema.grupo === GRUPO.epoca ||
      tema.grupo === GRUPO.genero
    ) {
      continue;
    }

    const semGrupo = tema.grupo === "";
    if (!semGrupo && !GRUPOS_DE_ENREDO.includes(tema.grupo)) continue;
    if (TAGS_QUE_NAO_DIZEM_NADA.has(valor)) continue;
    if (vistos.has(valor)) continue;
    vistos.add(valor);
    tags.push(valor);
  }

  return {
    elenco,
    tags,
    generos: generosDeTemas(tags),
    pais,
    classificacao,
  };
}

/** Os gêneros que estes temas sustentam, do mais forte para o mais fraco. */
export function generosDeTemas(tags: string[]): string[] {
  const presentes = new Set(tags.map(traduzir));

  return Object.entries(PESOS)
    .map(([slug, pesos]) => {
      let nota = 0;
      for (const [tema, peso] of Object.entries(pesos)) {
        if (presentes.has(tema)) nota += peso;
      }
      return { slug, nota };
    })
    .filter((g) => g.nota >= NOTA_MINIMA)
    .sort((a, b) => b.nota - a.nota || a.slug.localeCompare(b.slug))
    .slice(0, MAX_GENEROS)
    .map((g) => g.slug);
}
