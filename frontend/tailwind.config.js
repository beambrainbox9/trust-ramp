/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F1A2B", // deep navy base — financial-ledger seriousness, not pure black
        surface: "#16233A", // card/panel background, one step up from ink
        surfaceRaised: "#1E2E4A",
        paper: "#EDEBE3", // warm off-white text on dark surfaces
        guide: "#D8A657", // the AI tutor / guide accent — muted brass, not neon
        safe: "#4F9D8C", // practice / sandbox / zero-risk state
        risk: "#C75C4A", // reserved ONLY for real risk warnings, used sparingly
      },
      fontFamily: {
        display: ["Fraunces", "serif"], // credential/ledger feel for headlines
        body: ["Inter", "sans-serif"],
        data: ["IBM Plex Mono", "monospace"], // wallet addresses, amounts, chain data
      },
    },
  },
  plugins: [],
};
