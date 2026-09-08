/**
 * Onde está o ffmpeg.
 *
 * Em desenvolvimento vem do pacote `ffmpeg-static`, que baixa um binário para
 * o `node_modules`. No aplicativo instalado não há `node_modules`: o ffmpeg
 * viaja dentro do instalador, ao lado do executável, e o caminho chega por
 * `FFMPEG_BIN`.
 *
 * O ambiente vence porque é o caso mais específico — quem o define sabe
 * exatamente qual binário quer, e é assim que o app empacotado impõe o dele.
 */
let doPacote = null;
try {
  ({ default: doPacote } = await import("ffmpeg-static"));
} catch {
  // Sem `node_modules` isto simplesmente não existe, e não é erro: o app
  // instalado sempre define FFMPEG_BIN.
}

const caminho = process.env.FFMPEG_BIN?.trim() || doPacote || null;

export default caminho;
