/**
 * Catálogo de demonstração.
 *
 * Esta é a única fonte de conteúdo fictício do produto. Ela alimenta o seed do
 * banco e nada mais: telas e repositórios leem sempre do Postgres. Trocar por
 * catálogo real é substituir este arquivo (ou importar de um CMS) e rodar o
 * seed — nenhum componente muda.
 */

export type SeedEpisode = {
  title: string;
  synopsis: string;
  durationSec: number;
  premium?: boolean;
};

export type SeedSeason = {
  number: number;
  title: string;
  synopsis: string;
  episodes: SeedEpisode[];
};

export type SeedNovela = {
  slug: string;
  title: string;
  tagline: string;
  synopsis: string;
  status: "ONGOING" | "COMPLETED" | "COMING_SOON";
  accessTier: "FREE" | "PREMIUM";
  ageRating: string;
  year: number;
  accent: string;
  genres: string[];
  tags: string[];
  cast: { name: string; role: string }[];
  editorialNote?: string;
  featuredRank?: number;
  rating: number;
  ratingCount: number;
  releasedDaysAgo: number;
  popularity: number;
  seasons: SeedSeason[];
};

/**
 * Os gêneros são os mesmos do catálogo importado.
 *
 * A lista mora em `lib/media/temas` porque é lá que ela é decidida, a partir
 * dos temas que a origem manda. Duplicá-la aqui faria o catálogo de
 * demonstração e a biblioteca real divergirem no dia em que um gênero
 * mudasse de nome.
 */
export { GENEROS as GENRES } from "../lib/media/temas.ts";

export const NOVELAS: SeedNovela[] = [
  {
    slug: "herdeira-do-silencio",
    title: "Herdeira do Silêncio",
    tagline: "Ela voltou para a mansão. Ninguém sabe como empregada.",
    synopsis:
      "No enterro do pai, Beatriz descobre que foi trocada na maternidade e criada longe da própria herança. Ela aceita o emprego de copeira na casa que era sua para descobrir quem assinou a troca — e o único que desconfia dela é o filho da mulher que a substituiu.",
    status: "ONGOING",
    accessTier: "PREMIUM",
    ageRating: "16",
    year: 2026,
    accent: "#C42A55",
    genres: ["vinganca", "heranca-e-poder", "romance-proibido"],
    tags: ["troca na maternidade", "vingança fria", "mansão", "amor proibido"],
    cast: [
      { name: "Lorena Vilaça", role: "Beatriz Andrade" },
      { name: "Téo Sampaio", role: "Rafael Monteiro" },
      { name: "Dilma Arruda", role: "Cleide Monteiro" },
      { name: "Ivo Bezerra", role: "Dr. Aurélio" },
    ],
    editorialNote:
      "A estreia mais comentada do mês. Assista os três primeiros de uma vez: o gancho do episódio 3 é dos melhores do ano.",
    featuredRank: 1,
    rating: 4.8,
    ratingCount: 3184,
    releasedDaysAgo: 9,
    popularity: 9820,
    seasons: [
      {
        number: 1,
        title: "A troca",
        synopsis:
          "Beatriz entra na casa dos Monteiro com um crachá de copeira e uma certidão falsificada na bolsa.",
        episodes: [
          {
            title: "O caixão errado",
            synopsis:
              "Beatriz chega atrasada ao velório do pai e descobre que seu nome não está na lista de familiares.",
            durationSec: 118,
          },
          {
            title: "Uniforme dois números maior",
            synopsis:
              "Contratada sem entrevista, ela aprende que na casa dos Monteiro a empregada não olha nos olhos.",
            durationSec: 106,
          },
          {
            title: "A gaveta que range",
            synopsis:
              "Uma certidão de nascimento com duas assinaturas aparece onde ninguém devia procurar.",
            durationSec: 132,
          },
          {
            title: "Rafael pergunta o sobrenome",
            synopsis:
              "O herdeiro percebe que a copeira nova sabe onde fica o cofre.",
            durationSec: 121,
            premium: true,
          },
          {
            title: "Jantar de sete lugares",
            synopsis:
              "Cleide sorri para os convidados e ameaça Beatriz entre um prato e outro.",
            durationSec: 127,
            premium: true,
          },
          {
            title: "A enfermeira lembra",
            synopsis:
              "A mulher que trocou os bebês está viva — e cobra caro pelo silêncio.",
            durationSec: 140,
            premium: true,
          },
          {
            title: "Chuva na garagem",
            synopsis:
              "Rafael oferece guarda-chuva. Beatriz recusa e aceita a carona.",
            durationSec: 113,
            premium: true,
          },
          {
            title: "O que a Cleide queimou",
            synopsis:
              "Fumaça na lareira em pleno verão: alguém apagou a prova antes da hora.",
            durationSec: 136,
            premium: true,
          },
          {
            title: "Meu nome é Beatriz Andrade",
            synopsis: "Ela tira o uniforme no meio da sala de visitas.",
            durationSec: 149,
            premium: true,
          },
          {
            title: "A testemunha do cartório",
            synopsis:
              "O tabelião aposentado guarda uma cópia — e quer proteção antes de entregá-la.",
            durationSec: 131,
            premium: true,
          },
        ],
      },
      {
        number: 2,
        title: "Herança de sangue",
        synopsis:
          "Com o sobrenome de volta, Beatriz descobre que perder a mansão era o menor dos planos de Cleide.",
        episodes: [
          {
            title: "Advogado da parte contrária",
            synopsis:
              "O escritório que defendia seu pai agora trabalha contra ela.",
            durationSec: 124,
            premium: true,
          },
          {
            title: "Cleide chora na televisão",
            synopsis:
              "A vilã descobre que lágrima ao vivo vale mais que documento.",
            durationSec: 118,
            premium: true,
          },
          {
            title: "Rafael escolhe um lado",
            synopsis:
              "Ele assina a procuração. Não a que a mãe esperava.",
            durationSec: 145,
            premium: true,
          },
          {
            title: "Plantão de madrugada",
            synopsis:
              "A enfermeira é internada e Beatriz passa a noite ao lado da cama da mulher que arruinou sua vida.",
            durationSec: 152,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "coracao-em-plantao",
    title: "Coração em Plantão",
    tagline: "Doze horas de turno. Uma vida inteira de tensão.",
    synopsis:
      "Vitória topa o turno da noite no hospital mais movimentado da cidade para pagar a faculdade da irmã. O chefe da emergência é brilhante, insuportável e o único que percebe quando ela chora no depósito de materiais.",
    status: "ONGOING",
    accessTier: "FREE",
    ageRating: "14",
    year: 2026,
    accent: "#E03A69",
    genres: ["romance-proibido", "segundo-amor"],
    tags: ["hospital", "turno da noite", "inimigos a amantes", "slow burn"],
    cast: [
      { name: "Vitória Nunes", role: "Vitória Lemos" },
      { name: "Caio Bandeira", role: "Dr. Henrique Vaz" },
      { name: "Sula Menezes", role: "Enfermeira-chefe Zilda" },
    ],
    editorialNote:
      "Nossa porta de entrada favorita: quatro episódios grátis e você já sabe se vai maratonar.",
    featuredRank: 2,
    rating: 4.7,
    ratingCount: 5210,
    releasedDaysAgo: 26,
    popularity: 12440,
    seasons: [
      {
        number: 1,
        title: "Turno da noite",
        synopsis: "Trinta noites para provar que ela aguenta a emergência.",
        episodes: [
          {
            title: "Meia-noite e sete",
            synopsis:
              "Primeiro plantão, primeira parada cardíaca, primeira bronca na frente de todos.",
            durationSec: 104,
          },
          {
            title: "Café de máquina",
            synopsis:
              "Dr. Vaz descobre que a novata acerta veia em criança agitada.",
            durationSec: 98,
          },
          {
            title: "Leito 12",
            synopsis:
              "Um paciente pede para Vitória segurar sua mão até o filho chegar.",
            durationSec: 121,
          },
          {
            title: "Depósito de materiais",
            synopsis: "Ele encontra ela chorando e não diz nada. Fica.",
            durationSec: 110,
          },
          {
            title: "A escala trocada",
            synopsis:
              "Zilda coloca os dois no mesmo plantão por doze noites seguidas.",
            durationSec: 116,
            premium: true,
          },
          {
            title: "Sirene em dobro",
            synopsis:
              "Duas ambulâncias, um respirador. Alguém precisa decidir.",
            durationSec: 138,
            premium: true,
          },
          {
            title: "Amanhecer no estacionamento",
            synopsis:
              "Fim do turno, sol nascendo, e a pergunta que ela não devia responder.",
            durationSec: 125,
            premium: true,
          },
          {
            title: "A irmã aparece na emergência",
            synopsis:
              "O motivo de todos os plantões chega de maca, e Vitória congela.",
            durationSec: 143,
            premium: true,
          },
          {
            title: "Conselho de ética",
            synopsis:
              "Alguém denunciou o relacionamento. Henrique assume sozinho.",
            durationSec: 130,
            premium: true,
          },
          {
            title: "Plantão de despedida",
            synopsis:
              "Última noite antes da transferência. Ninguém dorme no sexto andar.",
            durationSec: 151,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "casamento-por-contrato",
    title: "Casamento por Contrato",
    tagline: "Trinta dias. Cláusula de sigilo. Nenhum beijo previsto.",
    synopsis:
      "Para salvar a padaria da família, Manu aceita fingir ser esposa do herdeiro que precisa de um casamento para assumir a presidência. O contrato tem quatorze cláusulas. Nenhuma delas prevê que ele vá conhecer a mãe dela.",
    status: "ONGOING",
    accessTier: "PREMIUM",
    ageRating: "14",
    year: 2026,
    accent: "#D9A355",
    genres: ["comedia-romantica", "heranca-e-poder", "romance-proibido"],
    tags: ["casamento de fachada", "ricos e pobres", "contrato", "família"],
    cast: [
      { name: "Manuela Prado", role: "Manu Ferraz" },
      { name: "Otávio Lins", role: "Dante Villaça" },
      { name: "Neide Barros", role: "Dona Alzira" },
    ],
    editorialNote:
      "A comédia mais gostosa do catálogo — e o episódio do almoço de domingo virou meme.",
    featuredRank: 3,
    rating: 4.6,
    ratingCount: 2870,
    releasedDaysAgo: 4,
    popularity: 8130,
    seasons: [
      {
        number: 1,
        title: "Quatorze cláusulas",
        synopsis: "Um mês de casamento, no papel.",
        episodes: [
          {
            title: "A proposta na fila do pão",
            synopsis:
              "Ele entra de terno às seis da manhã e oferece um contrato junto com o troco.",
            durationSec: 112,
          },
          {
            title: "Cláusula sétima: sem beijo",
            synopsis: "Manu negocia cada linha com caneta de padaria.",
            durationSec: 99,
          },
          {
            title: "Aliança tamanho errado",
            synopsis:
              "O cartório fecha em dez minutos e o anel não passa do nó do dedo.",
            durationSec: 107,
            premium: true,
          },
          {
            title: "Almoço de domingo",
            synopsis:
              "Dona Alzira serve quatro pratos e faz vinte perguntas. Dante responde todas errado.",
            durationSec: 134,
            premium: true,
          },
          {
            title: "O conselho não engoliu",
            synopsis:
              "A diretoria exige provas de que o casamento é real.",
            durationSec: 120,
            premium: true,
          },
          {
            title: "Uma cama, duas listas",
            synopsis:
              "A suíte do hotel tem uma cama. O contrato tem uma omissão.",
            durationSec: 141,
            premium: true,
          },
          {
            title: "A ex chega com pasta",
            synopsis:
              "Ela conhece cada cláusula — porque redigiu a primeira versão.",
            durationSec: 126,
            premium: true,
          },
          {
            title: "Dia trinta",
            synopsis:
              "O contrato vence à meia-noite e ninguém puxa o assunto.",
            durationSec: 148,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "sete-dias-de-fevereiro",
    title: "Sete Dias de Fevereiro",
    tagline: "Ela acordou casada com um homem que não reconhece.",
    synopsis:
      "Alice desperta no hospital com aliança no dedo e sete dias apagados da memória. O marido é atencioso, a casa é perfeita e todas as fotos do casamento têm a mesma pessoa cortada da moldura.",
    status: "ONGOING",
    accessTier: "PREMIUM",
    ageRating: "16",
    year: 2026,
    accent: "#4F7CC4",
    genres: ["suspense-passional", "segredos-de-familia"],
    tags: ["amnésia", "marido suspeito", "mistério", "reviravolta"],
    cast: [
      { name: "Alice Serrano", role: "Alice Bittencourt" },
      { name: "Marco Del Rey", role: "Fernando Bittencourt" },
      { name: "Joana Tavares", role: "Delegada Rute" },
    ],
    editorialNote:
      "Suspense de verdade: cada episódio termina pior do que começou.",
    featuredRank: 4,
    rating: 4.9,
    ratingCount: 1962,
    releasedDaysAgo: 2,
    popularity: 7400,
    seasons: [
      {
        number: 1,
        title: "A semana apagada",
        synopsis: "Sete dias, sete episódios, uma versão diferente em cada um.",
        episodes: [
          {
            title: "Segunda",
            synopsis:
              "Alice acorda entubada e a primeira palavra que ouve é seu novo sobrenome.",
            durationSec: 115,
          },
          {
            title: "Terça",
            synopsis:
              "A casa sabe onde ela guarda as coisas. Ela não.",
            durationSec: 108,
          },
          {
            title: "Quarta",
            synopsis:
              "Uma vizinha diz que nunca viu festa de casamento naquela rua.",
            durationSec: 122,
            premium: true,
          },
          {
            title: "Quinta",
            synopsis: "O álbum tem quatorze fotos e quatorze recortes.",
            durationSec: 130,
            premium: true,
          },
          {
            title: "Sexta",
            synopsis:
              "A delegada Rute reabre um boletim de ocorrência arquivado às pressas.",
            durationSec: 137,
            premium: true,
          },
          {
            title: "Sábado",
            synopsis:
              "Alice encontra a chave de um apartamento que não é o dela.",
            durationSec: 141,
            premium: true,
          },
          {
            title: "Domingo",
            synopsis:
              "A memória volta inteira, no pior momento possível.",
            durationSec: 156,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "doce-vinganca-de-marina",
    title: "Doce Vingança de Marina",
    tagline: "Roubaram a receita dela. Ela virou jurada do programa.",
    synopsis:
      "Marina perdeu a confeitaria, o noivo e o nome depois que a sócia registrou sua receita de bolo de milho no próprio CNPJ. Três anos depois, ela senta na bancada de jurados do reality onde a sócia é a grande favorita.",
    status: "ONGOING",
    accessTier: "FREE",
    ageRating: "12",
    year: 2025,
    accent: "#A01F45",
    genres: ["vinganca", "comedia-romantica"],
    tags: ["confeitaria", "reality show", "sócia traidora", "reviravolta"],
    cast: [
      { name: "Marina Quirino", role: "Marina Sales" },
      { name: "Bruna Ceccatto", role: "Sandra Vilela" },
      { name: "Elias Pontes", role: "Chef Ariel" },
    ],
    rating: 4.5,
    ratingCount: 4120,
    releasedDaysAgo: 61,
    popularity: 10310,
    seasons: [
      {
        number: 1,
        title: "Bancada dos jurados",
        synopsis: "Doze provas para desmontar três anos de mentira.",
        episodes: [
          {
            title: "O bolo de milho da vovó",
            synopsis:
              "Marina descobre a própria receita estampada numa embalagem de supermercado.",
            durationSec: 101,
          },
          {
            title: "Registro em nome de terceiro",
            synopsis:
              "O cartório confirma: assinatura dela, letra da sócia.",
            durationSec: 96,
          },
          {
            title: "Convite de jurada",
            synopsis:
              "A produção do reality liga achando que ela não vai aceitar.",
            durationSec: 109,
          },
          {
            title: "Sandra reconhece o perfume",
            synopsis:
              "Ao vivo, no primeiro corte, a favorita entende quem está julgando.",
            durationSec: 124,
            premium: true,
          },
          {
            title: "Prova do caramelo",
            synopsis:
              "Marina propõe uma prova que só quem inventou a receita sabe fazer.",
            durationSec: 132,
            premium: true,
          },
          {
            title: "O chef sabia",
            synopsis:
              "Ariel guardou o caderno original por três anos. E um motivo.",
            durationSec: 127,
            premium: true,
          },
          {
            title: "Final ao vivo",
            synopsis:
              "Trinta segundos de silêncio na televisão custam uma carreira.",
            durationSec: 146,
            premium: true,
          },
          {
            title: "Confeitaria nova, placa antiga",
            synopsis:
              "Ela reabre com o mesmo nome — e a fila dá a volta no quarteirão.",
            durationSec: 118,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "nunca-fui-sua-sombra",
    title: "Nunca Fui Sua Sombra",
    tagline: "A gêmea perfeita morreu. A outra foi obrigada a substituí-la.",
    synopsis:
      "Quando Helena morre num acidente, a família decide que Olívia vai assumir o lugar da irmã: o noivado, a empresa, o nome. Olívia aceita por três meses. No segundo mês, descobre que o acidente não foi acidente.",
    status: "ONGOING",
    accessTier: "PREMIUM",
    ageRating: "16",
    year: 2026,
    accent: "#8E6BC4",
    genres: ["segredos-de-familia", "suspense-passional", "vinganca"],
    tags: ["gêmeas", "identidade trocada", "noivado", "crime"],
    cast: [
      { name: "Olívia Rangel", role: "Olívia e Helena Duarte" },
      { name: "Ruy Albuquerque", role: "Vicente Sá" },
      { name: "Antônia Cardim", role: "Dona Eunice Duarte" },
    ],
    rating: 4.7,
    ratingCount: 1544,
    releasedDaysAgo: 17,
    popularity: 6220,
    seasons: [
      {
        number: 1,
        title: "Três meses",
        synopsis: "Um contrato familiar sem papel e sem saída.",
        episodes: [
          {
            title: "Duas certidões, um caixão",
            synopsis:
              "No velório, a mãe pede que Olívia use o vestido da irmã.",
            durationSec: 119,
          },
          {
            title: "A letra da Helena",
            synopsis:
              "Ela treina a assinatura da gêmea por seis horas seguidas.",
            durationSec: 105,
          },
          {
            title: "Vicente estranha o café",
            synopsis:
              "O noivo nota que ela passou a tomar açúcar. Não comenta.",
            durationSec: 113,
            premium: true,
          },
          {
            title: "Reunião de acionistas",
            synopsis:
              "Olívia lê um balanço que não entende e acerta a única pergunta que importava.",
            durationSec: 128,
            premium: true,
          },
          {
            title: "Freio sem fluido",
            synopsis: "O laudo do carro chega tarde e incompleto.",
            durationSec: 139,
            premium: true,
          },
          {
            title: "O diário no forro",
            synopsis:
              "Helena escrevia tudo. Inclusive o nome de quem ela temia.",
            durationSec: 144,
            premium: true,
          },
          {
            title: "Mês dois, dia trinta",
            synopsis:
              "Olívia decide continuar sendo Helena — agora por escolha.",
            durationSec: 151,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "amor-em-segunda-chamada",
    title: "Amor em Segunda Chamada",
    tagline: "Aos 46 anos, ela voltou para a sala de aula. E ele era o aluno.",
    synopsis:
      "Depois de vinte anos de casamento e um divórcio silencioso, Cida volta a estudar à noite para terminar o magistério. Na carteira ao lado senta um marceneiro viúvo que também está recomeçando tudo do zero.",
    status: "COMPLETED",
    accessTier: "FREE",
    ageRating: "12",
    year: 2025,
    accent: "#5FC79B",
    genres: ["segundo-amor", "reencontro"],
    tags: ["maturidade", "recomeço", "romance leve", "colo"],
    cast: [
      { name: "Aparecida Lopes", role: "Cida Meireles" },
      { name: "Nelson Fraga", role: "Wilson Braga" },
      { name: "Kelly Damasceno", role: "Professora Sônia" },
    ],
    editorialNote:
      "Se você quer chorar bonito num domingo à noite, é esta. Novela completa, oito episódios.",
    rating: 4.9,
    ratingCount: 6790,
    releasedDaysAgo: 120,
    popularity: 9010,
    seasons: [
      {
        number: 1,
        title: "Turma da noite",
        synopsis: "Um semestre para descobrir que ainda dá tempo.",
        episodes: [
          {
            title: "Matrícula às dezenove horas",
            synopsis:
              "Cida assina a ficha com a letra tremendo e mente a idade por reflexo.",
            durationSec: 102,
          },
          {
            title: "A carteira do fundo",
            synopsis:
              "Wilson oferece o lugar da frente. Ela recusa e senta ao lado dele.",
            durationSec: 97,
          },
          {
            title: "Prova de português",
            synopsis:
              "Duas décadas depois, ela lembra de tudo — menos de acentuar o próprio nome.",
            durationSec: 111,
          },
          {
            title: "Filha não aprova",
            synopsis:
              "A filha de Cida acha que estudar à noite é vergonha de família.",
            durationSec: 119,
          },
          {
            title: "Serra elétrica e poesia",
            synopsis:
              "Wilson faz uma estante para os livros dela e lê um poema errado de propósito.",
            durationSec: 124,
            premium: true,
          },
          {
            title: "O ex liga de madrugada",
            synopsis:
              "Vinte anos de casamento cabem numa ligação de quatro minutos.",
            durationSec: 130,
            premium: true,
          },
          {
            title: "Feira de ciências dos adultos",
            synopsis:
              "A turma da noite apresenta trabalho e a escola inteira aplaude de pé.",
            durationSec: 127,
            premium: true,
          },
          {
            title: "Formatura de dezembro",
            synopsis:
              "Beca alugada, neta na plateia e um pedido feito no microfone.",
            durationSec: 155,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "filha-do-mar",
    title: "Filha do Mar",
    tagline: "A vila enterrou uma menina que voltou andando pela areia.",
    synopsis:
      "Dezoito anos depois de ser dada por morta numa ressaca, Dora volta à vila de pescadores com outro nome e um advogado. Metade da comunidade a recebe com festa. A outra metade sabe que ninguém se afogou naquela noite.",
    status: "ONGOING",
    accessTier: "PREMIUM",
    ageRating: "14",
    year: 2026,
    accent: "#4F7CC4",
    genres: ["segredos-de-familia", "reencontro", "suspense-passional"],
    tags: ["vila de pescadores", "desaparecimento", "volta", "comunidade"],
    cast: [
      { name: "Dora Aguiar", role: "Dora / Isaura" },
      { name: "Jonas Tibúrcio", role: "Zeca do Farol" },
      { name: "Marlene Sobral", role: "Dona Firmina" },
    ],
    rating: 4.6,
    ratingCount: 1180,
    releasedDaysAgo: 33,
    popularity: 5240,
    seasons: [
      {
        number: 1,
        title: "Maré de sizígia",
        synopsis: "A água devolveu o que a vila combinou esquecer.",
        episodes: [
          {
            title: "Corpo que nunca chegou",
            synopsis:
              "A lápide tem nome e data. O caixão foi enterrado com pedras.",
            durationSec: 113,
          },
          {
            title: "Sotaque limpo demais",
            synopsis:
              "Dora pede peixe na feira e todo mundo para de falar.",
            durationSec: 104,
          },
          {
            title: "Zeca acende o farol",
            synopsis:
              "O único que a reconheceu de imediato foi quem a viu partir.",
            durationSec: 121,
            premium: true,
          },
          {
            title: "Ata da colônia",
            synopsis:
              "Um livro de registros mostra quem estava no mar naquela noite.",
            durationSec: 129,
            premium: true,
          },
          {
            title: "Firmina reza alto",
            synopsis:
              "A rezadeira faz uma promessa em voz alta e entrega um segredo sem querer.",
            durationSec: 134,
            premium: true,
          },
          {
            title: "Barco sem nome",
            synopsis:
              "Encontram a embarcação afundada a duzentos metros da praia.",
            durationSec: 142,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "o-retorno-da-patroa",
    title: "O Retorno da Patroa",
    tagline: "Demitiram a faxineira. Voltou a dona do prédio.",
    synopsis:
      "Neusa limpou o edifício Ipiranga por dezesseis anos até ser demitida por justa causa inventada. Um inventário mal resolvido a torna proprietária de sessenta por cento do prédio — e da vaga de garagem do síndico.",
    status: "COMPLETED",
    accessTier: "FREE",
    ageRating: "12",
    year: 2025,
    accent: "#D9A355",
    genres: ["vinganca", "heranca-e-poder", "comedia-romantica"],
    tags: ["justiça poética", "condomínio", "classe", "reviravolta"],
    cast: [
      { name: "Neusa Bonfim", role: "Neusa Batista" },
      { name: "Gerson Paiva", role: "Síndico Adalberto" },
      { name: "Yara Cordeiro", role: "Dra. Lígia" },
    ],
    rating: 4.4,
    ratingCount: 5560,
    releasedDaysAgo: 150,
    popularity: 8890,
    seasons: [
      {
        number: 1,
        title: "Assembleia extraordinária",
        synopsis: "Oito episódios e uma ata que ninguém queria assinar.",
        episodes: [
          {
            title: "Justa causa de mentira",
            synopsis:
              "Somem duas garrafas da adega e sobra o nome dela no aviso.",
            durationSec: 99,
          },
          {
            title: "Carta do inventário",
            synopsis:
              "Um envelope de cartório chega no barraco e ninguém acredita.",
            durationSec: 94,
          },
          {
            title: "Sessenta por cento",
            synopsis:
              "A advogada explica devagar. Neusa entende de primeira.",
            durationSec: 108,
          },
          {
            title: "Elevador social",
            synopsis:
              "Primeira vez em dezesseis anos que ela sobe pela porta da frente.",
            durationSec: 116,
          },
          {
            title: "Adalberto suando de terno",
            synopsis:
              "O síndico tenta um acordo por fora, com café e biscoito importado.",
            durationSec: 122,
            premium: true,
          },
          {
            title: "Reforma na área de serviço",
            synopsis:
              "A nova dona começa a obra pelo lugar onde almoçava sentada no chão.",
            durationSec: 127,
            premium: true,
          },
          {
            title: "Assembleia de quinta",
            synopsis:
              "Sessenta por cento dos votos e uma fala de quatro minutos.",
            durationSec: 141,
            premium: true,
          },
          {
            title: "Placa nova no hall",
            synopsis:
              "O prédio ganha outro nome. E um berçário no térreo.",
            durationSec: 119,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "a-noiva-de-aluguel",
    title: "A Noiva de Aluguel",
    tagline: "Ela aluga vestido. E, por engano, alugou a si mesma.",
    synopsis:
      "Tainá administra um ateliê de vestidos de noiva em Sorocaba e aceita fazer figuração num casamento de fachada para não perder o aluguel. O noivo contratante é o rapaz que a dispensou no baile de formatura.",
    status: "ONGOING",
    accessTier: "FREE",
    ageRating: "12",
    year: 2026,
    accent: "#F2648C",
    genres: ["comedia-romantica", "reencontro"],
    tags: ["ateliê", "casamento falso", "ex do colégio", "leve"],
    cast: [
      { name: "Tainá Feitosa", role: "Tainá Rosa" },
      { name: "Douglas Amorim", role: "Léo Cavalcanti" },
      { name: "Sirlene Mota", role: "Tia Gorete" },
    ],
    rating: 4.3,
    ratingCount: 2210,
    releasedDaysAgo: 12,
    popularity: 6640,
    seasons: [
      {
        number: 1,
        title: "Prova do vestido",
        synopsis: "Um casamento de mentira em sete episódios.",
        episodes: [
          {
            title: "Aluguel vence sexta",
            synopsis:
              "O ateliê tem três dias para faturar o que não faturou no mês.",
            durationSec: 100,
          },
          {
            title: "O cliente é ele",
            synopsis:
              "Léo entra pedindo orçamento e não reconhece a moça do balcão.",
            durationSec: 96,
          },
          {
            title: "Tia Gorete arma",
            synopsis:
              "A tia inventa que a sobrinha é a noiva e o combinado vira outro.",
            durationSec: 107,
          },
          {
            title: "Ensaio na igreja vazia",
            synopsis: "Marcha nupcial no celular e riso ecoando na nave.",
            durationSec: 114,
            premium: true,
          },
          {
            title: "Baile de formatura, versão adulta",
            synopsis:
              "Ele finalmente explica por que soltou a mão dela em 2011.",
            durationSec: 128,
            premium: true,
          },
          {
            title: "A noiva verdadeira liga",
            synopsis:
              "Tem uma pessoa a mais nessa história, e ela está no aeroporto.",
            durationSec: 131,
            premium: true,
          },
          {
            title: "Buquê jogado para trás",
            synopsis:
              "Quem pega o buquê num casamento de mentira ganha o quê?",
            durationSec: 140,
            premium: true,
          },
        ],
      },
    ],
  },
  {
    slug: "vespera-de-noiva",
    title: "Véspera de Noiva",
    tagline: "Estreia em breve: o vestido chega antes do noivo.",
    synopsis:
      "Na noite anterior ao casamento, seis mulheres ficam presas na casa de campo por causa da chuva. Uma delas não foi convidada. Nenhuma delas dorme.",
    status: "COMING_SOON",
    accessTier: "PREMIUM",
    ageRating: "16",
    year: 2026,
    accent: "#8E6BC4",
    genres: ["suspense-passional", "segredos-de-familia"],
    tags: ["huis clos", "casamento", "uma noite", "estreia"],
    cast: [
      { name: "Regina Sant'Ana", role: "Cláudia" },
      { name: "Bebel Fontoura", role: "Nina" },
    ],
    editorialNote: "Chega ao Plantão no próximo mês. Ative o aviso de estreia.",
    rating: 0,
    ratingCount: 0,
    releasedDaysAgo: -24,
    popularity: 2140,
    seasons: [
      {
        number: 1,
        title: "Uma noite",
        synopsis: "Seis mulheres, uma casa, e a chuva não passa.",
        episodes: [
          {
            title: "Chuva às vinte e duas",
            synopsis: "A estrada alaga e o portão emperra.",
            durationSec: 120,
            premium: true,
          },
        ],
      },
    ],
  },
];

/** Perfis de demonstração que povoam o feed da comunidade. */
export const DEMO_MEMBERS = [
  {
    name: "Rosana Piedade",
    email: "rosana@demo.noveleiras.app",
    handle: "rosanadeplantao",
    avatarSeed: "4",
  },
  {
    name: "Kelly Andrade",
    email: "kelly@demo.noveleiras.app",
    handle: "kellyk",
    avatarSeed: "7",
  },
  {
    name: "Dona Ivone",
    email: "ivone@demo.noveleiras.app",
    handle: "ivonedasete",
    avatarSeed: "2",
  },
  {
    name: "Tiago Menescal",
    email: "tiago@demo.noveleiras.app",
    handle: "tiagomen",
    avatarSeed: "9",
  },
  {
    name: "Lu Ferraz",
    email: "lu@demo.noveleiras.app",
    handle: "luferraz",
    avatarSeed: "5",
  },
];

export const DEMO_POSTS: {
  handle: string;
  novelaSlug?: string;
  kind: "THOUGHT" | "REVIEW" | "THEORY";
  body: string;
  spoiler?: boolean;
  rating?: number;
  hoursAgo: number;
  likes: number;
  comments: { handle: string; body: string; hoursAgo: number }[];
}[] = [
  {
    handle: "rosanadeplantao",
    novelaSlug: "herdeira-do-silencio",
    kind: "THEORY",
    body: "Gente, presta atenção na mão da Cleide no episódio 3. Ela mexe na aliança sempre que fala do parto. Não é nervosismo, é culpa. Aposto que ela assinou o papel junto com a enfermeira.",
    hoursAgo: 3,
    likes: 214,
    comments: [
      {
        handle: "kellyk",
        body: "AMIGA. Fui rever agora. É isso mesmo, ela gira a aliança duas vezes.",
        hoursAgo: 2,
      },
      {
        handle: "ivonedasete",
        body: "Eu acho que a enfermeira foi paga por outra pessoa. A Cleide é burra demais pra ter armado sozinha.",
        hoursAgo: 1,
      },
    ],
  },
  {
    handle: "ivonedasete",
    novelaSlug: "amor-em-segunda-chamada",
    kind: "REVIEW",
    body: "Terminei ontem à noite e fiquei acordada até tarde pensando. Tenho 58 anos e nunca vi uma novela tratar mulher da minha idade como gente que ainda pode querer coisa. A cena da estante me quebrou.",
    rating: 5,
    hoursAgo: 9,
    likes: 486,
    comments: [
      {
        handle: "luferraz",
        body: "A estante! Chorei igual criança. Mandei pra minha mãe assistir.",
        hoursAgo: 7,
      },
    ],
  },
  {
    handle: "kellyk",
    novelaSlug: "sete-dias-de-fevereiro",
    kind: "THOUGHT",
    body: "Não consigo assistir Sete Dias de noite, juro. Parei no episódio da quinta e fui dormir com a luz acesa. Alguém me diz só uma coisa: o Fernando é ou não é?",
    spoiler: true,
    hoursAgo: 14,
    likes: 167,
    comments: [
      {
        handle: "tiagomen",
        body: "Não vou falar nada. Mas assista a sexta de manhã, com sol. Confia.",
        hoursAgo: 12,
      },
    ],
  },
  {
    handle: "tiagomen",
    novelaSlug: "coracao-em-plantao",
    kind: "REVIEW",
    body: "Vim pelo hype e fiquei pela Zilda. A enfermeira-chefe carrega essa novela nas costas e ninguém está falando disso. Melhor personagem secundária do catálogo, sem discussão.",
    rating: 4,
    hoursAgo: 22,
    likes: 302,
    comments: [
      {
        handle: "rosanadeplantao",
        body: "Ela trocando a escala de propósito é o melhor plot device do ano kkkk",
        hoursAgo: 20,
      },
      {
        handle: "kellyk",
        body: "Zilda merecia novela própria.",
        hoursAgo: 18,
      },
    ],
  },
  {
    handle: "luferraz",
    novelaSlug: "casamento-por-contrato",
    kind: "THOUGHT",
    body: "O almoço de domingo é a melhor coisa que eu vi em vertical. O homem elogiou a farofa e a Dona Alzira olhou pra câmera como se fosse documentário. Assisti quatro vezes.",
    hoursAgo: 30,
    likes: 391,
    comments: [
      {
        handle: "ivonedasete",
        body: "Elogiar farofa de sogra é declaração de guerra, ele não sabia.",
        hoursAgo: 27,
      },
    ],
  },
  {
    handle: "rosanadeplantao",
    novelaSlug: "doce-vinganca-de-marina",
    kind: "THOUGHT",
    body: "A prova do caramelo é aula de vingança elegante. Ela não grita, não acusa, só pede pra fazer a receita na frente de todo mundo. Anota, Sandra.",
    hoursAgo: 41,
    likes: 258,
    comments: [],
  },
  {
    handle: "kellyk",
    kind: "THOUGHT",
    body: "Confesso: comecei a usar o Plantão porque a fila do ônibus é longa. Hoje eu chego mais cedo no ponto de propósito pra ver um episódio inteiro sentada.",
    hoursAgo: 54,
    likes: 512,
    comments: [
      {
        handle: "tiagomen",
        body: "Eu vejo no intervalo do almoço com fone. Vertical foi feito pra isso.",
        hoursAgo: 50,
      },
    ],
  },
];
