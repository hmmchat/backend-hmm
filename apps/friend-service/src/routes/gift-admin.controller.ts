import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const createGiftSchema = z.object({
  giftId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  emoji: z.string().min(1).max(10),
  coins: z.number().int().nonnegative(),
  diamonds: z.number().int().nonnegative()
});

const updateGiftSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  emoji: z.string().min(1).max(10).optional(),
  coins: z.number().int().nonnegative().optional(),
  diamonds: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional()
});

@Controller("admin/gifts")
export class GiftAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all gifts (active + inactive)
   * GET /admin/gifts
   */
  @Get()
  async getAll() {
    const gifts = await this.prisma.gift.findMany({
      orderBy: [
        { isActive: "desc" },
        { diamonds: "asc" },
        { name: "asc" }
      ] as any
    });
    return { ok: true, gifts };
  }

  /**
   * List only active gifts
   * GET /admin/gifts/active
   */
  @Get("active")
  async getActive() {
    const gifts = await this.prisma.gift.findMany({
      where: { isActive: true },
      orderBy: [
        { diamonds: "asc" },
        { name: "asc" }
      ] as any
    });
    return { ok: true, gifts };
  }

  /**
   * Create a new gift
   * POST /admin/gifts
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const data = createGiftSchema.parse(body);
    const gift = await this.prisma.gift.create({
      data: {
        giftId: data.giftId,
        name: data.name,
        emoji: data.emoji,
        coins: data.coins,
        diamonds: data.diamonds,
        isActive: true
      }
    });
    return { ok: true, gift };
  }

  /**
   * Update an existing gift
   * PATCH /admin/gifts/:id
   */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const data = updateGiftSchema.parse(body);
    const gift = await this.prisma.gift.update({
      where: { id },
      data: {
        name: data.name,
        emoji: data.emoji,
        coins: data.coins,
        diamonds: data.diamonds,
        isActive: data.isActive
      }
    });
    return { ok: true, gift };
  }

  /**
   * Soft delete / deactivate a gift
   * DELETE /admin/gifts/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param("id") id: string) {
    await this.prisma.gift.update({
      where: { id },
      data: { isActive: false }
    });
    return { ok: true };
  }

  /**
   * Hard delete a gift
   * DELETE /admin/gifts/:id/hard
   */
  @Delete(":id/hard")
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(@Param("id") id: string) {
    await this.prisma.gift.delete({
      where: { id }
    });
    return { ok: true };
  }
}

