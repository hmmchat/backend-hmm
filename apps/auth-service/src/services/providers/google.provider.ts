import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { OAuth2Client, TokenPayload } from "google-auth-library";

@Injectable()
export class ProviderGoogle {
  private client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  async verify(idToken: string) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });

      const payload: TokenPayload | undefined = ticket.getPayload();

      if (!payload) {
        throw new HttpException("Invalid Google ID token", HttpStatus.UNAUTHORIZED);
      }

      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      };
    } catch (err) {
      throw new HttpException(
        "Google verification failed: " + (err as Error).message,
        HttpStatus.UNAUTHORIZED
      );
    }
  }
}
