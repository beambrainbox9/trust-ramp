/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Dark/orange system (2026-08 retheme). Token NAMES kept stable on
        // purpose — `bg-ink`, `text-guide`, `bg-surfaceRaised` etc. are used
        // across ~40 call sites in existing components, so retheming is a
        // values-only change here rather than a find/replace across the app.
        ink: "#0A0A0B", // near-black base — never pure #000, keeps some warmth
        surface: "#141416", // card/panel background, one step up from ink
        surfaceRaised: "#1D1D20",
        paper: "#F4F1EA", // warm off-white text on dark surfaces
        guide: "#F2661C", // THE accent — orange. CTAs, active states, key data. Use sparingly.
        safe: "#4FAE8E", // practice / sandbox / zero-risk state — teal, reharmonized against orange
        risk: "#E4574A", // reserved ONLY for real risk warnings, used sparingly
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
