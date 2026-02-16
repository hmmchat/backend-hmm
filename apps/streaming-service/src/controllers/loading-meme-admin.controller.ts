import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { LoadingMemeService } from "../services/loading-meme.service.js";
import { z } from "zod";

const createMemeSchema = z.object({
  text: z.string().min(1).max(500),
  imageUrl: z.string().url(),
  category: z.string().optional(),
  order: z.number().optional(),
  createdBy: z.string().optional()
});

const updateMemeSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  imageUrl: z.string().url().optional(),
  category: z.string().optional(),
  isActive: z.boolean().optional(),
  order: z.number().optional()
});

@Controller("streaming/admin/loading-memes")
export class LoadingMemeAdminController {
  constructor(private readonly loadingMemeService: LoadingMemeService) {}

  /**
   * Get all loading screen memes (including inactive)
   * GET /streaming/admin/loading-memes
   */
  @Get()
  async getAll() {
    const memes = await this.loadingMemeService.getAllMemes();
    return {
      ok: true,
      memes
    };
  }

  /**
   * Get active loading screen memes only
   * GET /streaming/admin/loading-memes/active
   */
  @Get("active")
  async getActive() {
    const memes = await this.loadingMemeService.getActiveMemes();
    return {
      ok: true,
      memes
    };
  }

  /**
   * Create a new loading screen meme
   * POST /streaming/admin/loading-memes
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const data = createMemeSchema.parse(body);
    const meme = await this.loadingMemeService.createMeme(data);
    return {
      ok: true,
      meme
    };
  }

  /**
   * Update a loading screen meme
   * PATCH /streaming/admin/loading-memes/:id
   */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const data = updateMemeSchema.parse(body);
    const meme = await this.loadingMemeService.updateMeme(id, data);
    return {
      ok: true,
      meme
    };
  }

  /**
   * Delete a loading screen meme (soft delete)
   * DELETE /streaming/admin/loading-memes/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param("id") id: string) {
    await this.loadingMemeService.deleteMeme(id);
    return { ok: true };
  }

  /**
   * Hard delete a loading screen meme (permanent)
   * DELETE /streaming/admin/loading-memes/:id/hard
   */
  @Delete(":id/hard")
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(@Param("id") id: string) {
    await this.loadingMemeService.hardDeleteMeme(id);
    return { ok: true };
  }
}
