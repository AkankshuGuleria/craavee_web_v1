import type { Metadata } from "next";
import {
  Outfit,
  Geist,
  Geist_Mono,
  Space_Grotesk,
} from "next/font/google";
import "../styles/globals.css";
import { Providers } from "@/components/providers";
import { CraaveeIntroGate } from "@/components/layout/craavee-intro-gate";

const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
});

/* Premium geometric display face for hero headlines */
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  weight: ["500", "600", "700"],
});

const body = Geist({
  subsets: ["latin"],
  variable: "--font-body",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Craavee — In-Venue Commerce",
  description:
    "Premium in-venue ordering. Browse the menu, order from your seat, and watch it arrive in minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${grotesk.variable} ${display.variable} ${body.variable} ${mono.variable} font-body antialiased bg-[#0a0c10] text-slate-100 min-h-[100dvh]`}
      >
        <Providers>
          <CraaveeIntroGate>{children}</CraaveeIntroGate>
        </Providers>
      </body>
    </html>
  );
}
