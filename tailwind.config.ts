import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: "#0F0F0F",
        charcoal: "#1A1A1C",
        concrete: "#2A2A2D",
        ivory: "#F5F5F4",
        stone: "#A1A1AA",
        slate: "#71717A",
        ember: "#FF5C00",
        "ember-hover": "#E64A00",
        signal: "#10B981",
        warning: "#F59E0B",
        alert: "#E11D48",
        "whisper-border": "rgba(255,255,255,0.06)",
        "diffused-shadow": "rgba(0,0,0,0.4)",
      },
      fontFamily: {
        display: ["Outfit", "Cabinet Grotesk", "sans-serif"],
        body: ["Geist", "Satoshi", "sans-serif"],
        mono: ["Geist Mono", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        "cravee": "1rem",
        "cravee-lg": "1.5rem",
        pill: "9999px",
      },
      spacing: {
        margin: "20px",
        gutter: "16px",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        shimmer: "shimmer 2s infinite linear",
        pulse: "pulse 2s infinite",
        float: "float 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
