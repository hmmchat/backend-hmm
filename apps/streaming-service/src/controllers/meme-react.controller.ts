import { Controller, Get, Headers, HttpException, HttpStatus } from "@nestjs/common";
import { MemeReactConfig } from "../config/meme-react.config.js";

@Controller("streaming/meme-react")
export class MemeReactController {
  constructor(private readonly config: MemeReactConfig) {}

  /**
   * GET /streaming/meme-react/config
   * Requires x-user-id from API gateway.
   */
  @Get("config")
  getConfig(@Headers("x-user-id") xUserId: string | undefined) {
    if (!xUserId?.trim()) {
      throw new HttpException("Missing x-user-id", HttpStatus.UNAUTHORIZED);
    }
    return this.config.getPublicConfigForUser(xUserId.trim());
  }
}
