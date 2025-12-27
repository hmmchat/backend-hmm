import { Injectable } from "@nestjs/common";
import { jwtVerify, createRemoteJWKSet, JWTPayload } from "jose";

const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys")
);

@Injectable()
export class ProviderApple {
  private readonly issuer = "https://appleid.apple.com";
  private readonly audience = process.env.APPLE_AUD!;

  async verify(identityToken: string) {
    try {
      const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
        issuer: this.issuer,
        audience: this.audience
      });

      return this.mapPayload(payload);
    } catch (err) {
      throw new Error(
        "Apple verification failed: " + (err as Error).message
      );
    }
  }

  private mapPayload(payload: JWTPayload) {
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name
        ? String(payload.name)
        : ""
    };
  }
}