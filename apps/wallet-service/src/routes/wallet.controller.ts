import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { WalletService } from "../services/wallet.service.js";

@Controller()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
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

    // Verify token and get userId
    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);

    return this.walletService.getBalance(payload.sub);
  }
}

