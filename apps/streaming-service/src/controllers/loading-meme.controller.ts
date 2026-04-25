import { Controller, Get } from "@nestjs/common";
import { LoadingMemeService } from "../services/loading-meme.service.js";

@Controller("streaming/loading-memes")
export class LoadingMemeController {
  constructor(private readonly loadingMemeService: LoadingMemeService) {}

  /**
   * Get active loading screen memes for frontend selection.
   * Ordered memes should be displayed in order; unordered memes can be picked randomly.
   * GET /streaming/loading-memes
   */
  @Get()
  async getActiveMemes() {
    const memes = await this.loadingMemeService.getActiveMemes();
    return {
      ok: true,
      memes
    };
  }

  /**
   * Get a random loading screen meme (public endpoint for frontend)
   * GET /streaming/loading-memes/random
   */
  @Get("random")
  async getRandomMeme() {
    const meme = await this.loadingMemeService.getRandomMeme();
    return {
      ok: true,
      meme
    };
  }
}
