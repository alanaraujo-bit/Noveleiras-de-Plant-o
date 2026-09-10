/**
 * Espera do reel.
 *
 * Não usa esqueleto de cartões: o que vai chegar é uma tela cheia de vídeo, e
 * um esqueleto com blocos cinza prometeria um layout que não existe. Um campo
 * escuro com a marca respirando é mais honesto e some sem salto.
 */
export default function CarregandoPlantao() {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black">
      <span
        aria-hidden
        className="size-9 animate-spin rounded-full border-2 border-white/20 border-t-white/80"
      />
      <span className="sr-only">Montando sua fila de episódios</span>
    </div>
  );
}
