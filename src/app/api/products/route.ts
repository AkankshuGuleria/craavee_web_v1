import { NextResponse } from "next/server";
import type { Product } from "@/types";

let products: Product[] = [
  {
    id: "1",
    name: "Flamin' Hot Cheetos",
    description: "Crunched, spicy, addictive.",
    price: 45,
    category: "Munchies & Snacks",
    stock: 8,
    eta: 3,
    popular: false,
  },
  {
    id: "2",
    name: "Chocolate Hazelnut Spread",
    description: "Easy scoop, endless options.",
    price: 120,
    category: "Munchies & Snacks",
    stock: 4,
    eta: 3,
    popular: false,
  },
  {
    id: "3",
    name: "Protein Bar – Chocolate Fudge",
    description: "Sweet fix that fuels.",
    price: 85,
    category: "Munchies & Snacks",
    stock: 0,
    eta: 4,
    popular: false,
  },
  {
    id: "4",
    name: "Sparkling Water - Lime",
    description: "Crisp bubbles, fresh zest.",
    price: 50,
    category: "Cold Drinks & Beverages",
    stock: 15,
    eta: 2,
    popular: false,
  },
  {
    id: "5",
    name: "Iced Mango Slushie",
    description: "Tangy, sweet, icy.",
    price: 95,
    category: "Cold Drinks & Beverages",
    stock: 3,
    eta: 3,
    popular: false,
  },
  {
    id: "6",
    name: "Botanical Energy Drink - Citrus",
    description: "Zing without the crash.",
    price: 70,
    category: "Tea & Coffee",
    stock: 5,
    eta: 2,
    popular: false,
  },
  {
    id: "7",
    name: "Instant Coffee - Vanilla Coldbrew",
    description: "Ready in seconds.",
    price: 165,
    category: "Tea & Coffee",
    stock: 0,
    eta: 4,
    popular: false,
  },
  {
    id: "8",
    name: "Mini Ice Cream Pint - Cookies",
    description: "Creamy cookie chunks.",
    price: 55,
    category: "Ice Cream & Desserts",
    stock: 12,
    eta: 4,
    popular: true,
  },
  {
    id: "9",
    name: "Chocolate Chip Cookies (4-pack)",
    description: "Soft, chewy, gone fast.",
    price: 55,
    category: "Ice Cream & Desserts",
    stock: 3,
    eta: 4,
    popular: false,
  },
  {
    id: "10",
    name: "Instant Noodle Cup - Spicy",
    description: "Hot, fast, fragrant.",
    price: 40,
    category: "Instant Meals",
    stock: 18,
    eta: 3,
    popular: false,
  },
];

export async function GET() {
  return NextResponse.json({ success: true, data: products });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const newProduct: Product = {
      id: String(Date.now()),
      name: body.name,
      description: body.description || "",
      price: body.price,
      category: body.category || "Quick Bites",
      stock: body.stock ?? 10,
      eta: body.eta ?? 5,
      popular: body.popular || false,
    };

    products.push(newProduct);
    return NextResponse.json({ success: true, data: newProduct }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to create product" },
      { status: 400 }
    );
  }
}