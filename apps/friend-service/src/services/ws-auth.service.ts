import { Injectable } from "@nestjs/common";
import { verifyToken } from "@hmm/common";
import type { AccessPayload } from "@hmm/common";
import type { JWK } from "jose";

@Injectable()
export class WsAuthService {
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private jwtInitialized = false;

  private async initializeJWT() {
    if (this.jwtInitialized) return;
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk) as JWK;
    this.verifyAccess = await verifyToken(publicJwk);
    this.jwtInitialized = true;
  }

  async verifyAndGetUserId(token: string): Promise<string> {
    if (!token) throw new Error("Missing token");
    await this.initializeJWT();
    const payload = await this.verifyAccess(token);
    return payload.sub;
  }
}

