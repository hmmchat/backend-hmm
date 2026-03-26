import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { randomUUID } from "crypto";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const createGiftSchema = z.object({
  name: z.string().min(1).max(100),
  /** Optional — dashboard may omit; defaults to 🎁 */
  emoji: z.string().min(1).max(10).optional(),
  /**
   * Optional legacy/display. If omitted, we mirror diamonds.
   * This keeps older clients that display coins working.
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
    try {
      const gifts = await this.prisma.gift.findMany({
        orderBy: [
          { isActive: "desc" },
          { diamonds: "asc" },
          { name: "asc" }
        ] as any
      });
      return { ok: true, gifts };
    } catch (e: any) {
      // Production safety: if DB has not applied the diamonds migration yet,
      // fall back to ordering by coins/name so admin UI can still load.
      const msg = e?.message || String(e);
      if (msg.includes("diamonds") && (msg.includes("does not exist") || msg.includes("column"))) {
        const gifts = await this.prisma.gift.findMany({
          orderBy: [
            { isActive: "desc" },
            { coins: "asc" },
            { name: "asc" }
          ] as any
        });
        return { ok: true, gifts, warning: "DB missing diamonds column; apply friend-service migrations." };
      }
      throw e;
    }
  }

  /**
   * List only active gifts
   * GET /admin/gifts/active
   */
  @Get("active")
  async getActive() {
    try {
      const gifts = await this.prisma.gift.findMany({
        where: { isActive: true },
        orderBy: [
          { diamonds: "asc" },
          { name: "asc" }
        ] as any
      });
      return { ok: true, gifts };
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("diamonds") && (msg.includes("does not exist") || msg.includes("column"))) {
        const gifts = await this.prisma.gift.findMany({
          where: { isActive: true },
          orderBy: [
            { coins: "asc" },
            { name: "asc" }
          ] as any
        });
        return { ok: true, gifts, warning: "DB missing diamonds column; apply friend-service migrations." };
      }
      throw e;
    }
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
    const coins = data.coins ?? diamonds;
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
    const hasDiamonds = data.diamonds !== undefined;
    const hasCoins = data.coins !== undefined;
    const gift = await this.prisma.gift.update({
      where: { id },
      data: {
        name: data.name,
        emoji: data.emoji,
        diamonds: data.diamonds,
        // If diamonds changes and coins wasn't explicitly provided, mirror coins to diamonds.
        ...(hasDiamonds && !hasCoins ? { coins: data.diamonds } : { coins: data.coins }),
        ...(data.imageUrl !== undefined && {
          imageUrl: data.imageUrl === null ? null : data.imageUrl.trim() || null
        }),
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

