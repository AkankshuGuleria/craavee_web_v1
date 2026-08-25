import type { Metadata } from "next";
import { Outfit, Geist, Geist_Mono } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "@/components/providers";

const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
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
        className={`${display.variable} ${body.variable} ${mono.variable} font-body antialiased bg-[#fafaf7] text-neutral-900 min-h-[100dvh]`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
