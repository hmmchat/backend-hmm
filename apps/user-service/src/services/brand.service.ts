import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { SEARCH_DEFAULT_LIMIT } from "../config/limits.config.js";

export interface SearchBrandResult {
  id: string;
  name: string;
  domain: string | null;
  logoUrl: string | null;
}

/**
 * Brand service - manages brand catalog and search.
 * Brands and logos are self-hosted (no external API dependency).
 */
@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search brands by name (case-insensitive, partial match)
   */
  async searchBrands(query: string, limit?: number): Promise<SearchBrandResult[]> {
    const effectiveLimit = limit ?? SEARCH_DEFAULT_LIMIT;
    if (!query || query.trim().length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }

    if (effectiveLimit < 1 || effectiveLimit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    const brands = await this.prisma.brand.findMany({
      where: {
        name: {
          contains: query.trim(),
          mode: "insensitive"
        }
      },
      orderBy: { name: "asc" },
      take: effectiveLimit,
      select: {
        id: true,
        name: true,
        domain: true,
        logoUrl: true
      }
    });

    return brands;
  }
}
