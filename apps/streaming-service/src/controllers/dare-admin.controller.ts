import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const createDareSchema = z.object({
  dareId: z.string().min(1).max(100),
  text: z.string().min(1).max(500),
  category: z.string().optional(),
  order: z.number().int().optional()
});

const updateDareSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  category: z.string().optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional()
});

@Controller("streaming/admin/dares")
export class DareAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all dares in catalog (including inactive)
   * GET /streaming/admin/dares
   */
  @Get()
  async getAll() {
    const dares = await this.prisma.dareCatalog.findMany({
      orderBy: [
        { isActive: "desc" },
        { order: "asc" },
        { createdAt: "desc" }
      ]
    });

    return {
      ok: true,
      dares
    };
  }

  /**
   * Get active dares only
   * GET /streaming/admin/dares/active
   */
  @Get("active")
  async getActive() {
    const dares = await this.prisma.dareCatalog.findMany({
      where: { isActive: true },
      orderBy: [
        { order: "asc" },
        { createdAt: "desc" }
      ]
    });

    return {
      ok: true,
      dares
    };
  }

  /**
   * Create a new dare in catalog
   * POST /streaming/admin/dares
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const data = createDareSchema.parse(body);

    const dare = await this.prisma.dareCatalog.create({
      data: {
        dareId: data.dareId,
        text: data.text,
        category: data.category || null,
        order: data.order ?? null,
        isActive: true
      }
    });

    return {
      ok: true,
      dare
    };
  }

  /**
   * Update an existing dare
   * PATCH /streaming/admin/dares/:id
   */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const data = updateDareSchema.parse(body);

    const dare = await this.prisma.dareCatalog.update({
      where: { id },
      data: {
        text: data.text,
        category: data.category !== undefined ? data.category || null : undefined,
        isActive: data.isActive,
        order: data.order !== undefined ? data.order : undefined
      }
    });

    return {
      ok: true,
      dare
    };
  }

  /**
   * Soft delete (deactivate) a dare
   * DELETE /streaming/admin/dares/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param("id") id: string) {
    await this.prisma.dareCatalog.update({
      where: { id },
      data: { isActive: false }
    });
    return { ok: true };
  }

  /**
   * Hard delete a dare from catalog
   * DELETE /streaming/admin/dares/:id/hard
   */
  @Delete(":id/hard")
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(@Param("id") id: string) {
    await this.prisma.dareCatalog.delete({
      where: { id }
    });
    return { ok: true };
  }
}

