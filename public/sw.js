/**
 * Service worker do Noveleiras de Plantão.
 *
 * Escrito à mão de propósito: o app é pessoal e mutável (progresso, lista,
 * feed), então guardar páginas em cache seria mostrar informação velha. O que
 * cacheamos é o que não muda — o casco do app, os ícones e a arte gerada — e
 * o que garantimos é que, sem rede, apareça uma tela nossa em vez do dinossauro
 * do navegador.
 */

const VERSAO = "v1";
const CACHE_CASCO = `plantao-casco-${VERSAO}`;
const CACHE_ARTE = `plantao-arte-${VERSAO}`;

const CASCO = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icones/icone.svg",
  "/icones/icone-192.png",
  "/icones/icone-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_CASCO)
      .then((cache) => cache.addAll(CASCO))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(
          chaves
            .filter((chave) => !chave.endsWith(VERSAO))
            .map((chave) => caches.delete(chave)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function ehArte(url) {
  return (
    url.pathname.startsWith("/api/arte/") ||
    url.pathname.startsWith("/icones/") ||
    url.pathname.startsWith("/_next/static/")
  );
}

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);
  if (url.origin !== self.location.origin) return;

  // Vídeo nunca passa pelo cache: são arquivos grandes e servidos por faixa.
  if (url.pathname.startsWith("/media/") || url.pathname.startsWith("/api/midia/")) {
    return;
  }

  // Arte e estáticos: cache primeiro, é conteúdo imutável.
  if (ehArte(url)) {
    evento.respondWith(
      caches.match(requisicao).then(
        (guardado) =>
          guardado ??
          fetch(requisicao).then((resposta) => {
            if (resposta.ok) {
              const copia = resposta.clone();
              void caches.open(CACHE_ARTE).then((cache) => cache.put(requisicao, copia));
            }
            return resposta;
          }),
      ),
    );
    return;
  }

  // Navegação: rede primeiro, com a nossa tela de offline como rede de segurança.
  if (requisicao.mode === "navigate") {
    evento.respondWith(
      fetch(requisicao).catch(() =>
        caches.match("/offline.html").then(
          (guardado) =>
            guardado ??
            new Response("Sem conexão.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }),
        ),
      ),
    );
  }
});
