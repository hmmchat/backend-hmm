import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const createBrandSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(255).optional(),
  logoUrl: z.string().url().optional()
});

const updateBrandSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().min(1).max(255).optional(),
  logoUrl: z.string().url().or(z.literal("").transform(() => null)).optional()
});

@Controller("admin/brands")
export class BrandAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all brands
   * GET /admin/brands
   */
  @Get()
  async getAll() {
    const brands = await this.prisma.brand.findMany({
      orderBy: { name: "asc" }
    });
    return { ok: true, brands };
  }

  /**
   * Create a new brand
   * POST /admin/brands
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const data = createBrandSchema.parse(body);
    const brand = await this.prisma.brand.create({
      data: {
        name: data.name,
        domain: data.domain || null,
        logoUrl: data.logoUrl || null
      }
    });
    return { ok: true, brand };
  }

  /**
   * Update an existing brand
   * PATCH /admin/brands/:id
   */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const data = updateBrandSchema.parse(body);
    const brand = await this.prisma.brand.update({
      where: { id },
      data: {
        name: data.name,
        domain: data.domain !== undefined ? data.domain || null : undefined,
        logoUrl: data.logoUrl !== undefined ? (data.logoUrl as any) : undefined
      }
    });
    return { ok: true, brand };
  }

  /**
   * Delete a brand (hard delete).
   * NOTE: Will fail if any user_brands rows still reference this brand.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param("id") id: string) {
    await this.prisma.brand.delete({
      where: { id }
    });
    return { ok: true };
  }
}

