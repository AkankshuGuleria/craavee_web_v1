/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Same brand tokens as packages/ui/DESIGN.md (Craavee "fresh-tech
      // spatial commerce") — hand-mirrored here, not imported, since
      // packages/ui itself is Next.js-specific (uses next/link) and
      // isn't consumable from React Native without react-native-web
      // infrastructure this foundation phase doesn't set up. Keep these
      // two token sets in sync by hand until a cross-platform tokens
      // package is justified by real duplication pain.
      colors: {
        brand: "#178A50",
        "brand-deep": "#0E2A1D",
        paper: "#F3F5EC",
        inkdeep: "#122019",
        mango: "#FF8A3D",
      },
    },
  },
  plugins: [],
};
