import { NextResponse } from "next/server";
import { Order, OrderStatus } from "@/types";

let orders: Order[] = [
  {
    id: "1084",
    userId: "user-1",
    items: [],
    totalCredits: 240,
    status: "packed",
    seat: "Table B-2",
    eta: 8,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "1081",
    userId: "user-2",
    items: [],
    totalCredits: 85,
    status: "placed",
    seat: "Table A-14",
    eta: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export async function GET() {
  return NextResponse.json({ success: true, data: orders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const newOrder: Order = {
      id: String(Date.now()),
      userId: body.userId || "user-1",
      items: body.items || [],
      totalCredits: body.totalCredits || 0,
      status: "placed",
      seat: body.seat || "Table TBD",
      eta: body.eta || 8,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    orders.push(newOrder);
    return NextResponse.json({ success: true, data: newOrder }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to create order" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status } = body;

    const orderIndex = orders.findIndex((o) => o.id === id);
    if (orderIndex === -1) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    orders[orderIndex] = {
      ...orders[orderIndex],
      status: status as OrderStatus,
      updatedAt: new Date(),
    };

    return NextResponse.json({ success: true, data: orders[orderIndex] });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to update order" },
      { status: 400 }
    );
  }
}