import { Order, OrderStatus } from "@/types";

export class OrderRepository {
  async findAll(): Promise<Order[]> {
    return [];
  }

  async findById(id: string): Promise<Order | null> {
    return null;
  }

  async create(order: Order): Promise<Order> {
    return order;
  }

  async update(id: string, data: Partial<Order>): Promise<Order | null> {
    return null;
  }

  async findByUserId(userId: string): Promise<Order[]> {
    return [];
  }

  async findByStatus(status: OrderStatus): Promise<Order[]> {
    return [];
  }
}

export const orderRepository = new OrderRepository();
