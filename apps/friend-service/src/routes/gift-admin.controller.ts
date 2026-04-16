import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { randomUUID } from "crypto";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const createGiftSchema = z.object({
  name: z.string().min(1).max(100),
  /** Optional — dashboard may omit; defaults to 🎁 */
  emoji: z.string().min(1).max(10).optional(),
  /**
   * Legacy DB column only. Gift pricing for sends is `diamonds`; coins are not derived from diamonds
   * (diamonds are not convertible to coins — coin→diamond applies only when purchasing diamonds).
   * If omitted (e.g. dashboard), stored as 0.
   */
  coins: z.number().int().nonnegative().optional(),
  diamonds: z.number().int().nonnegative(),
  imageUrl: z.string().max(2048).optional()
});

const updateGiftSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  emoji: z.string().min(1).max(10).optional(),
  coins: z.number().int().nonnegative().optional(),
  diamonds: z.number().int().nonnegative().optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
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

    // Generate a stable giftId internally instead of accepting it from the client
    const giftId = randomUUID();
    const diamonds = data.diamonds;
    const coins = data.coins ?? 0;
    const emoji = data.emoji?.trim() || "🎁";

    const gift = await this.prisma.gift.create({
      data: {
        giftId,
        name: data.name,
        emoji,
        coins,
        diamonds,
        imageUrl: data.imageUrl?.trim() || null,
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

    const updateData: Record<string, unknown> = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.emoji !== undefined && { emoji: data.emoji }),
      ...(data.diamonds !== undefined && { diamonds: data.diamonds }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.imageUrl !== undefined && {
        imageUrl: data.imageUrl === null ? null : data.imageUrl.trim() || null
      }),
      ...(data.coins !== undefined && { coins: data.coins })
    };

    const gift = await this.prisma.gift.update({
      where: { id },
      data: updateData as any
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
