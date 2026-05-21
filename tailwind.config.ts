import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#050713",
        panel: "#0d1224",
        panel2: "#111a2f",
        cyanline: "#45f6ff",
        amberline: "#ffca63",
        blood: "#ff496d",
        mint: "#79ffbf"
      },
      boxShadow: {
        hud: "0 0 0 1px rgba(69,246,255,.18), 0 18px 60px rgba(0,0,0,.45)",
        glow: "0 0 24px rgba(69,246,255,.24)"
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
