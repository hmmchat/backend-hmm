import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const createBrandSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(255).optional(),
  // Signed B2/S3 URLs are long; don't cap at default URL heuristics beyond zod url().
  logoUrl: z.string().url().max(4096).optional().nullable()
});

const updateBrandSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().min(1).max(255).optional(),
  logoUrl: z
    .string()
    .url()
    .max(4096)
    .or(z.literal("").transform(() => null))
    .optional()
    .nullable()
});

@Controller("admin/brands")
export class BrandAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List content-managed brands (plus Brandfetch rows promoted via admin create).
   * GET /admin/brands
   */
  @Get()
  async getAll() {
    const brands = await this.prisma.brand.findMany({
      where: { isCustom: true },
      orderBy: { name: "asc" }
    });
    return { ok: true, brands };
  }

  /**
   * Create a new brand
   * POST /admin/brands
   *
   * Brand names are globally unique (incl. Brandfetch imports). If the name already
   * exists, update that row's logo/domain and promote it into the dashboard catalog
   * instead of returning an opaque 500.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const data = createBrandSchema.parse(body);
    const name = data.name.trim();

    const existing = await this.prisma.brand.findFirst({
      where: { name: { equals: name, mode: "insensitive" } }
    });

    if (existing) {
      const brand = await this.prisma.brand.update({
        where: { id: existing.id },
        data: {
          name,
          domain: data.domain !== undefined ? data.domain || null : existing.domain,
          logoUrl: data.logoUrl !== undefined ? data.logoUrl || null : existing.logoUrl,
          isCustom: true
        }
      });
      return { ok: true, brand, updatedExisting: true };
    }

    try {
      const brand = await this.prisma.brand.create({
        data: {
          name,
          domain: data.domain || null,
          logoUrl: data.logoUrl || null,
          isCustom: true
        }
      });
      return { ok: true, brand };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        throw new HttpException(
          `Brand name "${name}" already exists. Pick a different name.`,
          HttpStatus.CONFLICT
        );
      }
      throw err;
    }
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

