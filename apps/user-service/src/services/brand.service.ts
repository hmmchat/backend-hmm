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
   * Search brands by name using fuzzy matching (case-insensitive, typo-tolerant).
   * Always tries to return the closest matches, even when there is no exact brand.
   */
  async searchBrands(query: string, limit?: number): Promise<SearchBrandResult[]> {
    const effectiveLimit = limit ?? SEARCH_DEFAULT_LIMIT;
    const trimmedQuery = query?.trim();

    if (!trimmedQuery || trimmedQuery.length === 0) {
      throw new HttpException("Search query (q) is required", HttpStatus.BAD_REQUEST);
    }

    if (effectiveLimit < 1 || effectiveLimit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    // First, try trigram-based fuzzy search with the % operator (similar enough names).
    let brands = await this.prisma.$queryRaw<SearchBrandResult[]>`
      SELECT
        id,
        name,
        domain,
        "logoUrl"
      FROM "brands"
      WHERE lower(name) % lower(${trimmedQuery})
      ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
      LIMIT ${effectiveLimit};
    `;

    // If nothing passes the similarity threshold, fall back to nearest neighbours
    // without the % filter so we still return sensible suggestions.
    if (brands.length === 0) {
      brands = await this.prisma.$queryRaw<SearchBrandResult[]>`
        SELECT
          id,
          name,
          domain,
          "logoUrl"
        FROM "brands"
        ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
        LIMIT ${effectiveLimit};
      `;
    }

    return brands;
  }
}
