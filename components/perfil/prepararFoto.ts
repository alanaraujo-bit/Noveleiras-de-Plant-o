const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 1280;

type ImagemCarregada = {
  fonte: CanvasImageSource;
  largura: number;
  altura: number;
  liberar: () => void;
};

async function carregarImagem(file: File): Promise<ImagemCarregada> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    return {
      fonte: bitmap,
      largura: bitmap.width,
      altura: bitmap.height,
      liberar: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const imagem = new Image();
  imagem.decoding = "async";
  imagem.src = url;
  try {
    await imagem.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    fonte: imagem,
    largura: imagem.naturalWidth,
    altura: imagem.naturalHeight,
    liberar: () => URL.revokeObjectURL(url),
  };
}

/**
 * Reduz fotos de câmera antes do upload. Além de acelerar o envio no 4G, isso
 * mantém o corpo da requisição abaixo do limite das funções da Vercel.
 */
export async function prepararFotoPerfil(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Escolha uma imagem da galeria ou da câmera.");
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error("A foto original deve ter no máximo 20 MB.");
  }

  let imagem: ImagemCarregada;
  try {
    imagem = await carregarImagem(file);
  } catch {
    throw new Error(
      "Não consegui abrir esse formato. Escolha uma foto JPG, PNG ou WebP.",
    );
  }

  try {
    const escala = Math.min(1, MAX_SIDE / Math.max(imagem.largura, imagem.altura));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagem.largura * escala));
    canvas.height = Math.max(1, Math.round(imagem.altura * escala));
    const contexto = canvas.getContext("2d", { alpha: false });
    if (!contexto) throw new Error("CANVAS_UNAVAILABLE");
    contexto.drawImage(imagem.fonte, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.8),
    );
    if (!blob) throw new Error("ENCODE_FAILED");
    return new File([blob], "foto-perfil.webp", { type: "image/webp" });
  } catch {
    throw new Error("Não consegui preparar essa foto. Escolha outra imagem.");
  } finally {
    imagem.liberar();
  }
}

/**
 * Renderiza o enquadramento escolhido no editor. A imagem resultante já é um
 * quadrado, portanto o servidor não precisa adivinhar qual parte do retrato a
 * pessoa queria preservar.
 */
export async function recortarFotoPerfil(
  file: File,
  enquadramento: { escala: number; deslocamentoX: number; deslocamentoY: number },
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Escolha uma imagem da galeria ou da câmera.");
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error("A foto original deve ter no máximo 20 MB.");
  }

  let imagem: ImagemCarregada;
  try {
    imagem = await carregarImagem(file);
  } catch {
    throw new Error("Não consegui abrir esse formato. Escolha uma foto JPG, PNG ou WebP.");
  }

  try {
    const lado = 512;
    const escalaBase = Math.max(lado / imagem.largura, lado / imagem.altura);
    const escala = escalaBase * enquadramento.escala;
    const largura = imagem.largura * escala;
    const altura = imagem.altura * escala;
    const limiteX = Math.max(0, (largura - lado) / 2);
    const limiteY = Math.max(0, (altura - lado) / 2);
    const x = Math.max(-limiteX, Math.min(limiteX, enquadramento.deslocamentoX * (lado / 300)));
    const y = Math.max(-limiteY, Math.min(limiteY, enquadramento.deslocamentoY * (lado / 300)));
    const canvas = document.createElement("canvas");
    canvas.width = lado;
    canvas.height = lado;
    const contexto = canvas.getContext("2d", { alpha: false });
    if (!contexto) throw new Error("CANVAS_UNAVAILABLE");
    contexto.fillStyle = "#130810";
    contexto.fillRect(0, 0, lado, lado);
    contexto.drawImage(imagem.fonte, (lado - largura) / 2 + x, (lado - altura) / 2 + y, largura, altura);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.86),
    );
    if (!blob) throw new Error("ENCODE_FAILED");
    return new File([blob], "foto-perfil.webp", { type: "image/webp" });
  } catch {
    throw new Error("Não consegui preparar essa foto. Escolha outra imagem.");
  } finally {
    imagem.liberar();
  }
}
