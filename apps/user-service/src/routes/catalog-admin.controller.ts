import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const createInterestSchema = z.object({
  name: z.string().min(1).max(100),
  genre: z.string().max(100).optional()
});

const updateInterestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  genre: z.string().max(100).optional()
});

const createValueSchema = z.object({
  name: z.string().min(1).max(100)
});

const updateValueSchema = z.object({
  name: z.string().min(1).max(100).optional()
});

const createIntentPromptSchema = z.object({
  text: z.string().min(1).max(100),
  order: z.number().optional()
});

const updateIntentPromptSchema = z.object({
  text: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  order: z.number().optional()
});

@Controller("admin")
export class CatalogAdminController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Interests catalog management
   */

  @Get("interests")
  async getAllInterests() {
    const interests = await this.prisma.interest.findMany({
      orderBy: [
        { genre: "asc" },
        { name: "asc" }
      ]
    });
    return { ok: true, interests };
  }

  @Post("interests")
  @HttpCode(HttpStatus.CREATED)
  async createInterest(@Body() body: unknown) {
    const data = createInterestSchema.parse(body);
    const interest = await this.prisma.interest.create({
      data: {
        name: data.name,
        genre: data.genre || null
      }
    });
    return { ok: true, interest };
  }

  @Patch("interests/:id")
  async updateInterest(@Param("id") id: string, @Body() body: unknown) {
    const data = updateInterestSchema.parse(body);
    const interest = await this.prisma.interest.update({
      where: { id },
      data: {
        name: data.name,
        genre: data.genre !== undefined ? data.genre || null : undefined
      }
    });
    return { ok: true, interest };
  }

  @Delete("interests/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteInterest(@Param("id") id: string) {
    // Note: This will fail if there are userInterests pointing at this row due to FK.
    // Admins should migrate or clear user data before hard deleting.
    await this.prisma.interest.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Values catalog management
   */

  @Get("values")
  async getAllValues() {
    const values = await this.prisma.value.findMany({
      orderBy: { name: "asc" }
    });
    return { ok: true, values };
  }

  @Post("values")
  @HttpCode(HttpStatus.CREATED)
  async createValue(@Body() body: unknown) {
    const data = createValueSchema.parse(body);
    const value = await this.prisma.value.create({
      data: {
        name: data.name
      }
    });
    return { ok: true, value };
  }

  @Patch("values/:id")
  async updateValue(@Param("id") id: string, @Body() body: unknown) {
    const data = updateValueSchema.parse(body);
    const value = await this.prisma.value.update({
      where: { id },
      data: {
        name: data.name
      }
    });
    return { ok: true, value };
  }

  @Delete("values/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteValue(@Param("id") id: string) {
    // Note: This will fail if there are userValues pointing at this row due to FK.
    await this.prisma.value.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Intent prompts catalog management
   */

  @Get("intent-prompts")
  async getAllIntentPrompts() {
    const prompts = await this.prisma.intentPrompt.findMany({
      orderBy: [
        { isActive: "desc" },
        { order: "asc" },
        { createdAt: "desc" }
      ]
    });
    return { ok: true, prompts };
  }

  @Post("intent-prompts")
  @HttpCode(HttpStatus.CREATED)
  async createIntentPrompt(@Body() body: unknown) {
    const data = createIntentPromptSchema.parse(body);
    const prompt = await this.prisma.intentPrompt.create({
      data: {
        text: data.text,
        order: data.order || null
      }
    });
    return { ok: true, prompt };
  }

  @Patch("intent-prompts/:id")
  async updateIntentPrompt(@Param("id") id: string, @Body() body: unknown) {
    const data = updateIntentPromptSchema.parse(body);
    const prompt = await this.prisma.intentPrompt.update({
      where: { id },
      data: {
        text: data.text,
        isActive: data.isActive,
        order: data.order
      }
    });
    return { ok: true, prompt };
  }

  @Delete("intent-prompts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteIntentPrompt(@Param("id") id: string) {
    await this.prisma.intentPrompt.delete({ where: { id } });
    return { ok: true };
  }
}

