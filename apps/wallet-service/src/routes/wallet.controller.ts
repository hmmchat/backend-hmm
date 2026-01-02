import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { WalletService } from "../services/wallet.service.js";
import { z } from "zod";

const GenderFilterTransactionSchema = z.object({
  amount: z.number().positive(),
  screens: z.number().positive()
});

@Controller()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    return payload.sub;
  }

  /**
   * Get current user's coin balance
   * GET /me/balance
   */
  @Get("me/balance")
  async getMyBalance(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    return this.walletService.getBalance(userId);
  }

  /**
   * Deduct coins for gender filter purchase
   * POST /me/transactions/gender-filter
   * 
   * Body: { amount: number, screens: number }
   */
  @Post("me/transactions/gender-filter")
  async deductCoinsForGenderFilter(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const userId = await this.verifyTokenAndGetUserId(token);
    const dto = GenderFilterTransactionSchema.parse(body);

    try {
      return await this.walletService.deductCoinsForGenderFilter(
        userId,
        dto.amount,
        dto.screens
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("Insufficient balance")) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        "Failed to process transaction",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

