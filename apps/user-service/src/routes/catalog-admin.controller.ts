import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { PREFERRED_CITY_ANYWHERE_IN_INDIA, rewriteExpiredStorageUrl } from "@hmm/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { BrandService } from "../services/brand.service.js";
import { UserService } from "../services/user.service.js";

const createInterestSchema = z.object({
  name: z.string().min(1).max(100),
  genre: z.string().trim().min(1).max(100)
});

const updateInterestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  genre: z.string().trim().min(1).max(100).optional()
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

const cityMusicPreferenceSchema = z
  .object({
    songName: z.string().min(1).max(200),
    artistName: z.string().min(1).max(200),
    albumArtUrl: z.string().url().max(2048).optional().nullable(),
    spotifyId: z.string().max(128).optional().nullable()
  })
  .nullable();

const createDiscoveryCityOptionSchema = z.object({
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(120),
  intent: z.string().min(1).max(255),
  faceCardImageUrl: z.string().url().max(2048).optional().nullable(),
  order: z.number().optional(),
  isActive: z.boolean().optional(),
  /** Up to 5 brand ids from the Brands catalog. */
  brandIds: z.array(z.string().min(1)).max(5).optional(),
  /** Spotify/manual song for the city face card; null clears. */
  musicPreference: cityMusicPreferenceSchema.optional()
});

const updateDiscoveryCityOptionSchema = z.object({
  value: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(120).optional(),
  intent: z.string().min(1).max(255).optional(),
  faceCardImageUrl: z.string().url().max(2048).optional().nullable(),
  order: z.number().optional(),
  isActive: z.boolean().optional(),
  brandIds: z.array(z.string().min(1)).max(5).optional(),
  musicPreference: cityMusicPreferenceSchema.optional()
});

const discoveryCityInclude = {
  musicPreference: {
    select: {
      id: true,
      name: true,
      artist: true,
      albumArtUrl: true,
      spotifyId: true
    }
  },
  brands: {
    orderBy: { order: "asc" as const },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          domain: true,
          brandfetchId: true
        }
      }
    }
  }
};

function serializeDiscoveryCityOption(
  option: any,
  resolveLogo?: (domain: string | null, logoUrl: string | null, brandfetchId?: string | null) => string | null
) {
  const brands = (option.brands || []).map((row: any) => ({
    id: row.brand?.id ?? row.brandId,
    name: row.brand?.name ?? "",
    logoUrl: resolveLogo
      ? resolveLogo(row.brand?.domain ?? null, row.brand?.logoUrl ?? null, row.brand?.brandfetchId ?? null)
      : (row.brand?.logoUrl ?? null),
    domain: row.brand?.domain ?? null,
    order: row.order
  }));
  return {
    id: option.id,
    value: option.value,
    label: option.label,
    intent: option.intent ?? null,
    faceCardImageUrl: rewriteExpiredStorageUrl(option.faceCardImageUrl ?? null),
    order: option.order ?? null,
    isActive: option.isActive,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
    musicPreferenceId: option.musicPreferenceId ?? null,
    musicPreference: option.musicPreference
      ? {
          id: option.musicPreference.id,
          name: option.musicPreference.name,
          artist: option.musicPreference.artist,
          albumArtUrl: option.musicPreference.albumArtUrl ?? null,
          spotifyId: option.musicPreference.spotifyId ?? null
        }
      : null,
    brandIds: brands.map((b: { id: string }) => b.id),
    brands
  };
}

const updateModeratorFaceCardSchema = z.object({
  username: z.string().min(1).max(80).optional(),
  intent: z.string().min(1).max(255).optional(),
  displayPictureUrl: z.string().url().max(2048).optional().nullable(),
  city: z.string().min(1).max(120).optional()
});

@Controller("admin")
export class CatalogAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly brandService: BrandService
  ) {}

  private serializeCityOption(option: any) {
    return serializeDiscoveryCityOption(option, (domain, logoUrl, brandfetchId) =>
      this.brandService.resolvePublicLogoUrl(domain, logoUrl, brandfetchId)
    );
  }

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
        genre: data.genre
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
        genre: data.genre
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

  /**
   * Discovery / profile preferred city catalog (values must match `users.preferredCity` for real cities).
   */

  private async resolveCityMusicPreferenceId(
    musicPreference: z.infer<typeof cityMusicPreferenceSchema> | undefined
  ): Promise<string | null | undefined> {
    if (musicPreference === undefined) return undefined;
    if (musicPreference === null) return null;
    const song = await this.prisma.song.upsert({
      where: {
        name_artist: {
          name: musicPreference.songName.trim(),
          artist: musicPreference.artistName.trim()
        }
      },
      create: {
        name: musicPreference.songName.trim(),
        artist: musicPreference.artistName.trim(),
        albumArtUrl: musicPreference.albumArtUrl ?? null,
        spotifyId: musicPreference.spotifyId ?? undefined
      },
      update: {
        albumArtUrl:
          musicPreference.albumArtUrl !== undefined
            ? musicPreference.albumArtUrl || null
            : undefined,
        spotifyId:
          musicPreference.spotifyId !== undefined
            ? musicPreference.spotifyId || undefined
            : undefined
      }
    });
    return song.id;
  }

  private async replaceCityBrands(cityOptionId: string, brandIds: string[]) {
    const uniqueIds = [...new Set(brandIds.map((id) => id.trim()).filter(Boolean))].slice(0, 5);
    if (uniqueIds.length > 0) {
      const found = await this.prisma.brand.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true }
      });
      if (found.length !== uniqueIds.length) {
        throw new HttpException("One or more brand ids are invalid.", HttpStatus.BAD_REQUEST);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await (tx as any).discoveryCityBrand.deleteMany({ where: { cityOptionId } });
      if (uniqueIds.length === 0) return;
      await (tx as any).discoveryCityBrand.createMany({
        data: uniqueIds.map((brandId, order) => ({
          cityOptionId,
          brandId,
          order
        }))
      });
    });
  }

  @Get("discovery-city-options")
  async getAllDiscoveryCityOptions() {
    const options = await (this.prisma as any).discoveryCityOption.findMany({
      orderBy: [{ isActive: "desc" }, { order: "asc" }, { label: "asc" }],
      include: discoveryCityInclude
    });
    return { ok: true, options: options.map((o: any) => this.serializeCityOption(o)) };
  }

  @Post("discovery-city-options")
  @HttpCode(HttpStatus.CREATED)
  async createDiscoveryCityOption(@Body() body: unknown) {
    const data = createDiscoveryCityOptionSchema.parse(body);
    const intent = data.intent.trim();
    if (!intent) {
      throw new HttpException("Intent is required for discovery cities.", HttpStatus.BAD_REQUEST);
    }
    const musicPreferenceId = await this.resolveCityMusicPreferenceId(data.musicPreference);
    const option = await (this.prisma as any).discoveryCityOption.create({
      data: {
        value: data.value,
        label: data.label,
        intent,
        faceCardImageUrl: rewriteExpiredStorageUrl(data.faceCardImageUrl ?? null),
        order: data.order ?? null,
        isActive: data.isActive !== false,
        musicPreferenceId: musicPreferenceId ?? null
      },
      include: discoveryCityInclude
    });
    if (data.brandIds) {
      await this.replaceCityBrands(option.id, data.brandIds);
    }
    const hydrated = await (this.prisma as any).discoveryCityOption.findUnique({
      where: { id: option.id },
      include: discoveryCityInclude
    });
    return { ok: true, option: this.serializeCityOption(hydrated) };
  }

  @Patch("discovery-city-options/:id")
  async updateDiscoveryCityOption(@Param("id") id: string, @Body() body: unknown) {
    const data = updateDiscoveryCityOptionSchema.parse(body);
    const existing = await (this.prisma as any).discoveryCityOption.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException("Discovery city option not found.", HttpStatus.NOT_FOUND);
    }
    const nextIntent = data.intent !== undefined ? data.intent.trim() : existing.intent;
    const nextIsActive = data.isActive !== undefined ? data.isActive : existing.isActive;
    if (nextIsActive && (!nextIntent || String(nextIntent).trim().length === 0)) {
      throw new HttpException(
        "Intent is required before publishing an active discovery city.",
        HttpStatus.BAD_REQUEST
      );
    }
    const musicPreferenceId = await this.resolveCityMusicPreferenceId(data.musicPreference);
    await (this.prisma as any).discoveryCityOption.update({
      where: { id },
      data: {
        value: data.value,
        label: data.label,
        intent: data.intent !== undefined ? data.intent.trim() : undefined,
        faceCardImageUrl:
          data.faceCardImageUrl !== undefined
            ? rewriteExpiredStorageUrl(data.faceCardImageUrl)
            : undefined,
        order: data.order,
        isActive: data.isActive,
        ...(musicPreferenceId !== undefined ? { musicPreferenceId } : {})
      }
    });
    if (data.brandIds) {
      await this.replaceCityBrands(id, data.brandIds);
    }
    const option = await (this.prisma as any).discoveryCityOption.findUnique({
      where: { id },
      include: discoveryCityInclude
    });
    return { ok: true, option: this.serializeCityOption(option) };
  }

  @Delete("discovery-city-options/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDiscoveryCityOption(@Param("id") id: string) {
    const existing = await (this.prisma as any).discoveryCityOption.findUnique({ where: { id } });
    if (existing?.value === PREFERRED_CITY_ANYWHERE_IN_INDIA) {
      throw new HttpException("Cannot delete the built-in Anywhere in India option.", HttpStatus.BAD_REQUEST);
    }
    await (this.prisma as any).discoveryCityOption.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Shared moderator discovery face card (singleton). Edited from Beam dashboard.
   */
  @Get("moderator-face-card")
  async getModeratorFaceCardSettings() {
    return this.userService.adminGetModeratorFaceCardSettings();
  }

  @Patch("moderator-face-card")
  async updateModeratorFaceCardSettings(@Body() body: unknown) {
    const data = updateModeratorFaceCardSchema.parse(body ?? {});
    return this.userService.adminUpdateModeratorFaceCardSettings(data);
  }
}

