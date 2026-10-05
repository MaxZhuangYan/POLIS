import type { Metadata, Viewport } from "next";
// The game's pixel font (OFL, full Simplified Chinese, one woff2 ≈ 600 KB, loaded only when something uses it).
// Imported ONCE here: the HUD uses it through `--font-pixel` (globals.css), Phaser waits for it in BootScene.
import "@fontsource/fusion-pixel-12px-proportional-sc/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polis · 守护灵",
  description: "你是守护灵：没有身体，只能在它拿不定主意时低语一句。它会记住你，但它有自己的立场。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2b180d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
