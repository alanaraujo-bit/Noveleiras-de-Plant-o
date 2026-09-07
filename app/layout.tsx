import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";

import "./globals.css";
import { TelemetryProvider } from "@/components/sistema/TelemetryProvider";
import { ToastProvider } from "@/components/sistema/ToastProvider";
import { RegistrarServiceWorker } from "@/components/sistema/RegistrarServiceWorker";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const APP_NAME = "Noveleiras de Plantão";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — novelas verticais para maratonar`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Novelas verticais brasileiras para assistir em episódios curtos: romance, vingança, herança e comunidade. Seu plantão começa agora.",
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, address: false, email: false },
  icons: {
    icon: [{ url: "/icones/icone.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icones/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: APP_NAME,
    title: `${APP_NAME} — novelas verticais para maratonar`,
    description:
      "Episódios curtos, histórias inteiras. Romance, vingança e comunidade em um só lugar.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#130810",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>
        <ToastProvider>
          <TelemetryProvider>{children}</TelemetryProvider>
        </ToastProvider>
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
