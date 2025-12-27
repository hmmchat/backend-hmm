import { Injectable, HttpException, HttpStatus } from "@nestjs/common";

interface FacebookUserResponse {
  id?: string;
  name?: string;
  email?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
}

@Injectable()
export class ProviderFacebook {
  private readonly GRAPH_API = "https://graph.facebook.com/v19.0/me";

  async verify(accessToken: string) {
    try {
      const url = `${this.GRAPH_API}?access_token=${accessToken}&fields=id,name,email,picture.width(200).height(200)`;
      const res = await fetch(url);

      if (!res.ok) {
        const text = await res.text();
        throw new HttpException(`Facebook API error: ${text}`, HttpStatus.UNAUTHORIZED);
      }

      // ✅ Type assertion fixes TS error
      const json = (await res.json()) as FacebookUserResponse;

      // ✅ Runtime check for required field
      if (!json.id) {
        throw new HttpException(
          "Facebook login failed: missing user id",
          HttpStatus.UNAUTHORIZED
        );
      }

      return {
        id: json.id,
        name: json.name ?? "",
        email: json.email,
        picture: json.picture?.data?.url
      };
    } catch (err) {
      throw new HttpException(
        "Facebook verification failed: " + (err as Error).message,
        HttpStatus.UNAUTHORIZED
      );
    }
  }
}