import { User, ApiResponse } from "@/types";

export class UserService {
  async getById(id: string): Promise<ApiResponse<User>> {
    return { success: false, error: "Not implemented" };
  }

  async getByEmail(email: string): Promise<ApiResponse<User>> {
    return { success: false, error: "Not implemented" };
  }

  async create(data: Partial<User>): Promise<ApiResponse<User>> {
    return { success: false, error: "Not implemented" };
  }

  async updateCredits(userId: string, amount: number): Promise<ApiResponse<User>> {
    return { success: false, error: "Not implemented" };
  }

  async getRunners(): Promise<ApiResponse<User[]>> {
    return { success: false, error: "Not implemented" };
  }
}

export const userService = new UserService();
