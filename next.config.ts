import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O indicador flutuante cobre o canto superior direito, justamente onde a
  // interface tem ações. Atrapalha a inspeção visual em tela de celular.
  devIndicators: false,

  poweredByHeader: false,

  // Catálogo e Busca viraram uma tela só. Os endereços antigos continuam
  // valendo — atalhos instalados, links compartilhados e o histórico do
  // navegador — e caem no Explorar; quem vinha da busca chega com o campo aberto.
  async redirects() {
    return [
      { source: "/inicio", destination: "/explorar", permanent: false },
      { source: "/buscar", destination: "/explorar?buscar=1", permanent: false },
    ];
  },

  async headers() {
    return [
      {
        // O service worker precisa poder controlar toda a origem e não deve
        // ficar preso em cache entre versões.
        source: "/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        // Mídia de demonstração servida localmente: cache longo, já que cada
        // arquivo é imutável.
        source: "/media/:caminho*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
          { key: "Accept-Ranges", value: "bytes" },
        ],
      },
    ];
  },
};

export default nextConfig;
