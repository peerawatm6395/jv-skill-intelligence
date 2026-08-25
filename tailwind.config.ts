import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        evidence: {
          system: "#6b7280",     // gray - SYSTEM_EVIDENCE_ONLY
          validated: "#2563eb",  // blue - HUMAN_VALIDATED
          blended: "#059669",    // green - BLENDED
        },
        confidence: {
          high: "#059669",
          medium: "#d97706",
          low: "#dc2626",
        },
        layer: {
          skill: "#4f46e5",
          evidence: "#0891b2",
          labor: "#78716c",
          gap: "#b45309",
        },
      },
    },
  },
  plugins: [],
};
export default config;
