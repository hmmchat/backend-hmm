import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const updateZodiacSchema = z.object({
  imageUrl: z.string().url().or(z.literal("").transform(() => null)).optional(),
  order: z.number().int().min(0).optional()
});

@Controller("admin/zodiacs")
export class ZodiacAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all zodiacs (admin)
   * GET /admin/zodiacs
   */
  @Get()
  async getAll() {
    const zodiacs = await (this.prisma as any).zodiac.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }]
    });
    return { ok: true, zodiacs };
  }

  /**
   * Update zodiac image/order (admin)
   * PATCH /admin/zodiacs/:id
   */
  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  async update(@Param("id") id: string, @Body() body: unknown) {
    const data = updateZodiacSchema.parse(body);
    const updated = await (this.prisma as any).zodiac.update({
      where: { id },
      data: {
        imageUrl: data.imageUrl !== undefined ? (data.imageUrl as any) : undefined,
        order: data.order !== undefined ? data.order : undefined
      }
    });
    return { ok: true, zodiac: updated };
  }
}

