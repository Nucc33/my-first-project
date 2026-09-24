import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arb Scanner",
  description: "Read-only Kalshi ↔ Polymarket arbitrage scanner",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
