import { Product, ApiResponse } from "@/types";

export class ProductService {
  async getAll(): Promise<ApiResponse<Product[]>> {
    return { success: true, data: [] };
  }

  async getById(id: string): Promise<ApiResponse<Product>> {
    return { success: false, error: "Not implemented" };
  }

  async create(data: Partial<Product>): Promise<ApiResponse<Product>> {
    return { success: false, error: "Not implemented" };
  }

  async update(id: string, data: Partial<Product>): Promise<ApiResponse<Product>> {
    return { success: false, error: "Not implemented" };
  }

  async delete(id: string): Promise<ApiResponse<void>> {
    return { success: false, error: "Not implemented" };
  }

  async getByCategory(category: string): Promise<ApiResponse<Product[]>> {
    return { success: false, error: "Not implemented" };
  }
}

export const productService = new ProductService();
