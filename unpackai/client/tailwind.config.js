/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#08142e",
        panel: "#151c3a",
        panelSoft: "#1b2448",
        cyanGlow: "#38bdf8",
        violetGlow: "#8b5cf6",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 30px rgba(56, 189, 248, 0.25)",
        violet: "0 0 28px rgba(139, 92, 246, 0.24)",
      },
    },
  },
  plugins: [],
};
