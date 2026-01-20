import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { IcebreakerService } from "../services/icebreaker.service.js";
import { z } from "zod";

const createIcebreakerSchema = z.object({
  question: z.string().min(1).max(500),
  category: z.string().optional(),
  order: z.number().optional(),
  createdBy: z.string().optional()
});

const updateIcebreakerSchema = z.object({
  question: z.string().min(1).max(500).optional(),
  category: z.string().optional(),
  isActive: z.boolean().optional(),
  order: z.number().optional()
});

@Controller("streaming/admin/icebreakers")
export class IcebreakerAdminController {
  constructor(private icebreakerService: IcebreakerService) {}

  /**
   * Get all icebreakers (including inactive)
   * GET /admin/icebreakers
   */
  @Get()
  async getAll() {
    const icebreakers = await this.icebreakerService.getAllIcebreakers();
    return {
      ok: true,
      icebreakers
    };
  }

  /**
   * Get active icebreakers only
   * GET /admin/icebreakers/active
   */
  @Get("active")
  async getActive() {
    const icebreakers = await this.icebreakerService.getActiveIcebreakers();
    return {
      ok: true,
      icebreakers
    };
  }

  /**
   * Create a new icebreaker
   * POST /admin/icebreakers
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const data = createIcebreakerSchema.parse(body);
    const icebreaker = await this.icebreakerService.createIcebreaker(data);
    return {
      ok: true,
      icebreaker
    };
  }

  /**
   * Update an icebreaker
   * PATCH /admin/icebreakers/:id
   */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const data = updateIcebreakerSchema.parse(body);
    const icebreaker = await this.icebreakerService.updateIcebreaker(id, data);
    return {
      ok: true,
      icebreaker
    };
  }

  /**
   * Delete an icebreaker (soft delete)
   * DELETE /admin/icebreakers/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param("id") id: string) {
    await this.icebreakerService.deleteIcebreaker(id);
    return { ok: true };
  }

  /**
   * Hard delete an icebreaker (permanent)
   * DELETE /admin/icebreakers/:id/hard
   */
  @Delete(":id/hard")
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(@Param("id") id: string) {
    await this.icebreakerService.hardDeleteIcebreaker(id);
    return { ok: true };
  }
}
