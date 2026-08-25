import { Product } from "@/types";

export class ProductRepository {
  async findAll(): Promise<Product[]> {
    return [];
  }

  async findById(id: string): Promise<Product | null> {
    return null;
  }

  async create(product: Product): Promise<Product> {
    return product;
  }

  async update(id: string, data: Partial<Product>): Promise<Product | null> {
    return null;
  }

  async delete(id: string): Promise<boolean> {
    return false;
  }

  async findByCategory(category: string): Promise<Product[]> {
    return [];
  }
}

export const productRepository = new ProductRepository();
