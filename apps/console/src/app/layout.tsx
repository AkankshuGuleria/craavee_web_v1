import type { Metadata } from "next";
import { Outfit, Geist, Geist_Mono } from "next/font/google";
import "../styles/globals.css";

// No Providers wrapper here — the old app's `Providers` component was
// fake localStorage auth/cart/address state for the retired customer
// surface (docs/audit/BACKEND_READINESS.md). Console's real auth
// (Supabase session + JWT role claim) is Phase 3+ work — this layout is
// intentionally a plain shell until then, per this phase's hard stop on
// business logic.
const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
});

const body = Geist({ subsets: ["latin"], variable: "--font-body" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Craavee Console",
  description: "Operations console — live orders, catalog, inventory, and staff management.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} font-body antialiased bg-[#0a0c10] text-slate-100 min-h-[100dvh]`}
      >
        {children}
      </body>
    </html>
  );
}
