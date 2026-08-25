import { NextResponse } from "next/server";
import { Order } from "@/types";

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
  {
    id: "1078",
    userId: "user-3",
    items: [],
    totalCredits: 360,
    status: "packed",
    seat: "VIP Lounge 1",
    eta: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "1075",
    userId: "user-4",
    items: [],
    totalCredits: 80,
    status: "packed",
    seat: "Table C-4",
    eta: 6,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export async function GET() {
  const pendingOrders = orders.filter(
    (o) => o.status === "placed" || o.status === "packed"
  );
  return NextResponse.json({ success: true, data: pendingOrders });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, runnerId } = body;

    const orderIndex = orders.findIndex((o) => o.id === id);
    if (orderIndex === -1) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    orders[orderIndex] = {
      ...orders[orderIndex],
      runnerId,
      status: "assigned",
      updatedAt: new Date(),
    };

    return NextResponse.json({ success: true, data: orders[orderIndex] });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to claim order" },
      { status: 400 }
    );
  }
}