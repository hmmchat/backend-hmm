import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { OAuth2Client, TokenPayload } from "google-auth-library";

@Injectable()
export class ProviderGoogle {
  private client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  async verify(token: string) {
    try {
      // Check if it's a JWT (ID Token) or an Access Token
      // JWTs have 3 segments separated by dots
      if (token.split(".").length === 3) {
        const ticket = await this.client.verifyIdToken({
          idToken: token,
          audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload: TokenPayload | undefined = ticket.getPayload();

        if (!payload) {
          throw new HttpException("Invalid Google ID token", HttpStatus.UNAUTHORIZED);
        }

        return {
          sub: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
        };
      } else {
        // Treat as Access Token and fetch user info from Google's userinfo endpoint
        // Use direct fetch to avoid "No access, refresh token..." error from OAuth2Client
        const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Google API returned ${response.status}: ${errorText}`);
        }

        const payload = (await response.json()) as any;

        if (!payload || !payload.sub) {
          throw new HttpException("Invalid Google access token", HttpStatus.UNAUTHORIZED);
        }

        return {
          sub: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
        };
      }
    } catch (err) {
      throw new HttpException(
        "Google verification failed: " + (err as Error).message,
        HttpStatus.UNAUTHORIZED
      );
    }
  }
}
