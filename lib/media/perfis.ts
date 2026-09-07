/**
 * Perfis de saída da transcodificação.
 *
 * Em código, e não em tabela, pelo mesmo motivo dos planos: um perfil é
 * decisão de produto e muda junto com o player. Cada um carrega os argumentos
 * que o agente passa ao ffmpeg — o painel não monta linha de comando, e o
 * agente não inventa parâmetro.
 *
 * Vive fora de `lib/painel/acoes/` porque um arquivo `"use server"` só pode
 * exportar funções assíncronas. Exportar este objeto de lá compilava e
 * derrubava a tela em produção com "found object" — o erro só aparece no
 * build de produção, onde as ações viram referências de rede.
 */
export const PERFIS_DE_SAIDA = {
  "720p": {
    nome: "720p",
    descricao: "Metade da banda, mesma proporção vertical.",
    args: [
      "-vf", "scale=-2:1280",
      "-c:v", "libx264", "-crf", "24", "-preset", "veryfast",
      "-c:a", "aac", "-b:a", "96k",
    ],
    extensao: "mp4",
  },
  "480p": {
    nome: "480p",
    descricao: "Para conexão ruim; é o que salva a reprodução no 3G.",
    args: [
      "-vf", "scale=-2:854",
      "-c:v", "libx264", "-crf", "26", "-preset", "veryfast",
      "-c:a", "aac", "-b:a", "64k",
    ],
    extensao: "mp4",
  },
  hls: {
    nome: "HLS",
    descricao: "Fatiado em segmentos, para troca de qualidade durante a reprodução.",
    args: [
      "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
      "-c:a", "aac",
      "-hls_time", "6", "-hls_playlist_type", "vod",
    ],
    extensao: "m3u8",
  },
} as const;

export type PerfilDeSaida = keyof typeof PERFIS_DE_SAIDA;
