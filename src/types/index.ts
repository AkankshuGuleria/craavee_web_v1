export interface User {
  id: string;
  email: string;
  role: "customer" | "runner" | "admin";
  credits: number;
  seat?: string;
  createdAt: Date;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl?: string;
  stock: number;
  eta: number;
  popular: boolean;
}

export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  product: Product;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  totalCredits: number;
  status: OrderStatus;
  seat: string;
  eta: number;
  runnerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OrderStatus =
  | "placed"
  | "packed"
  | "assigned"
  | "picked_up"
  | "delivered"
  | "cancelled";

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  product: Product;
}

export interface Runner {
  id: string;
  userId: string;
  status: "active" | "busy" | "offline";
  currentLocation?: string;
  user: User;
}

export interface Venue {
  id: string;
  name: string;
  tables: Table[];
}

export interface Table {
  id: string;
  venueId: string;
  label: string;
  section?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}