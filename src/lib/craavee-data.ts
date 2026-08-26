import { products } from "./products";

/* ------------------------------------------------------------------ */
/* Curated content for the scroll-driven stacked glass-card journey.  */
/* Everything references real catalogue items by id — swap ids for    */
/* API data later without touching the components.                    */
/* ------------------------------------------------------------------ */

const byId = (id: string) => products.find((p) => p.id === id) ?? products[0];

export type StackCardType = "intro" | "categories" | "fresh" | "cta";

export interface CategoryTile {
  label: string;
  emoji: string;
}

export interface StackCardData {
  id: number;
  type: StackCardType;
  accent: string;
  glow: string;
  eyebrow?: string;
  title?: string;
  /** Liquid morphing phrases for the scene heading (title is the fallback). */
  liquid?: string[];
  description?: string;
  categories?: CategoryTile[];
  productIds?: string[];
}

export const stackCards: StackCardData[] = [
  {
    id: 1,
    type: "intro",
    accent: "#fb7185",
    glow: "rgba(251,113,133,0.35)",
    eyebrow: "Quick commerce, but make it fun.",
    liquid: [
      "You crave it.",
      "We bring it.",
      "Everything you crave.",
      "Fast every time.",
    ],
    title: "You crave it.",
    description:
      "Everything you want, from everyday essentials to those very specific cravings.",
    productIds: ["1", "25", "8"],
  },
  {
    id: 2,
    type: "categories",
    accent: "#a78bfa",
    glow: "rgba(167,139,250,0.32)",
    title: "What's your mood?",
    liquid: [
      "What's your mood?",
      "Pick your craving.",
      "Find your thing.",
      "Browse the good stuff.",
    ],
    description: "Pick a category. We'll handle the rest.",
    categories: [
      { label: "Snacks", emoji: "🍿" },
      { label: "Drinks", emoji: "🥤" },
      { label: "Fruits", emoji: "🍓" },
      { label: "Vegetables", emoji: "🥦" },
      { label: "Dairy", emoji: "🥛" },
      { label: "Breakfast", emoji: "🥞" },
      { label: "Instant Food", emoji: "🍜" },
      { label: "Personal Care", emoji: "🧼" },
    ],
  },
  {
    id: 3,
    type: "fresh",
    accent: "#34d399",
    glow: "rgba(52,211,153,0.3)",
    title: "Fresh stuff.",
    liquid: [
      "Fresh stuff.",
      "No fuss.",
      "Stock the fridge.",
      "Fresh every day.",
    ],
    description:
      "Milk for breakfast. Bananas for later. Everything you forgot until now.",
    productIds: ["21", "24", "25", "26", "22"],
  },
  {
    id: 4,
    type: "cta",
    accent: "#ffb15c",
    glow: "rgba(255,177,92,0.35)",
    title: "So… what are you craving?",
    liquid: [
      "What are you craving?",
      "Ready to order?",
      "Your craving awaits.",
      "Let's get it.",
    ],
    description: "Your next craving is only a few taps away.",
  },
];

/** Resolve product objects for a card (order preserved). */
export const productsFor = (card: StackCardData): Product[] =>
  (card.productIds ?? []).map(byId);

type Product = (typeof products)[number];
