/** @type {import('tailwindcss').Config} */
// Tokens come from @craavee/tokens — the single source shared with the
// web apps. This file used to hard-code five hex values that had to be
// kept in step with lib/theme.ts by hand; both carried comments admitting
// it. The consumer surface is the customer/runner palette.
const tokens = require("@craavee/tokens/tailwind.cjs");

module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: tokens.consumer },
  plugins: [],
};
