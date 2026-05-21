import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polis - AI Agent Society Simulation",
  description: "A game-like AI agent contract economy simulation prototype."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
