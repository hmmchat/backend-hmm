import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";
import { PrismaService } from "../prisma/prisma.service.js";
import { SEARCH_DEFAULT_LIMIT } from "../config/limits.config.js";

export interface SearchBrandResult {
  id: string;
  name: string;
  domain: string | null;
  logoUrl: string | null;
}

interface BrandfetchLogo {
  type?: string;
  theme?: string;
  formats?: Array<{ src?: string }>;
}

interface BrandfetchResult {
  name?: string;
  domain?: string;
  icon?: string;
  logos?: BrandfetchLogo[];
}

/**
 * Brand service - manages brand catalog and search.
 * Uses Brandfetch for search with DB fallback for resilience.
 */
@Injectable()
export class BrandService {
  private readonly brandfetchClientId: string;
  private readonly brandfetchEnabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    this.brandfetchClientId = process.env.BRANDFETCH_CLIENT_ID || "";
    this.brandfetchEnabled =
      process.env.BRANDFETCH_ENABLED !== "false" && !!this.brandfetchClientId;
  }

  private getBrandfetchLogo(brand: BrandfetchResult): string | null {
    if (brand.icon) return brand.icon;
    if (!Array.isArray(brand.logos) || brand.logos.length === 0) return null;

    // Prefer icon/primary logos first, then any available source.
    const prioritized = [...brand.logos].sort((a, b) => {
      const score = (logo: BrandfetchLogo) => {
        let s = 0;
        if (logo.type === "icon") s += 3;
        if (logo.theme === "light") s += 1;
        return s;
      };
      return score(b) - score(a);
    });

    for (const logo of prioritized) {
      const src = logo.formats?.find(f => !!f.src)?.src;
      if (src) return src;
    }

    return null;
  }

  private normalizeDomain(domain?: string): string | null {
    if (!domain) return null;
    return domain.trim().toLowerCase() || null;
  }

  private async searchBrandfetch(query: string, limit: number): Promise<SearchBrandResult[]> {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.brandfetch.io/v2/search/${encodedQuery}?c=${limit}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.brandfetchClientId}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Brandfetch search failed: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as unknown;
    const items = Array.isArray(payload) ? payload as BrandfetchResult[] : [];

    return items
      .filter(item => !!item.name)
      .map(item => {
        const domain = this.normalizeDomain(item.domain);
        const safeName = (item.name || "").trim();
        const syntheticId = domain
          ? `brandfetch:${domain}`
          : `brandfetch:${safeName.toLowerCase().replace(/\s+/g, "-")}`;

        return {
          id: syntheticId,
          name: safeName,
          domain,
          logoUrl: this.getBrandfetchLogo(item)
        };
      });
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Upsert Brandfetch rows into the local catalog so GET /brands returns real DB ids
   * (PATCH /me/brand-preferences expects brandIds from `brands`).
   */
  private async persistBrandfetchResultsToCatalog(
    results: SearchBrandResult[]
  ): Promise<SearchBrandResult[]> {
    const out: SearchBrandResult[] = [];

    for (const r of results) {
      try {
        let row =
          r.domain != null
            ? await this.prisma.brand.findFirst({ where: { domain: r.domain } })
            : null;

        if (!row) {
          row = await this.prisma.brand.findFirst({
            where: { name: { equals: r.name, mode: "insensitive" } }
          });
        }

        if (row) {
          const updated = await this.prisma.brand.update({
            where: { id: row.id },
            data: {
              logoUrl: r.logoUrl ?? row.logoUrl,
              domain: r.domain ?? row.domain
            }
          });
          out.push({
            id: updated.id,
            name: updated.name,
            domain: updated.domain,
            logoUrl: updated.logoUrl
          });
          continue;
        }

        const created = await this.prisma.brand.create({
          data: {
            name: r.name,
            domain: r.domain,
            logoUrl: r.logoUrl
          }
        });
        out.push({
          id: created.id,
          name: created.name,
          domain: created.domain,
          logoUrl: created.logoUrl
        });
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") {
          const fallback = await this.prisma.brand.findFirst({
            where: { name: { equals: r.name, mode: "insensitive" } }
          });
          if (fallback) {
            out.push({
              id: fallback.id,
              name: fallback.name,
              domain: fallback.domain,
              logoUrl: r.logoUrl ?? fallback.logoUrl
            });
            continue;
          }
        }
        console.warn(
          `[BrandService] persistBrandfetchResultsToCatalog failed for "${r.name}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        out.push(r);
      }
    }

    return out;
  }

  /**
   * Seed queries for GET /brands (no user search term). Comma-separated in env, or built-in list.
   */
  private defaultSuggestionSeeds(): string[] {
    const raw = process.env.BRANDFETCH_DEFAULT_QUERIES;
    if (raw && raw.trim()) {
      return raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    }
    return [
      "tech",
      "retail",
      "fashion",
      "food",
      "sport",
      "finance",
      "auto",
      "beauty",
      "travel",
      "media"
    ];
  }

  /**
   * Suggested brands for the "pick brands" screen (GET /brands).
   * Merges Brandfetch search results from shuffled seed queries until `limit` unique brands or max API calls.
   */
  async getBrandSuggestions(limit: number): Promise<SearchBrandResult[]> {
    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    if (!this.brandfetchEnabled) {
      return [];
    }

    const seeds = this.shuffle(this.defaultSuggestionSeeds());
    const seen = new Set<string>();
    const out: SearchBrandResult[] = [];
    const maxCalls = Math.min(seeds.length, 8);

    for (let i = 0; i < maxCalls && out.length < limit; i++) {
      try {
        const chunk = await this.searchBrandfetch(seeds[i], Math.min(50, limit * 2));
        for (const b of chunk) {
          const key = b.domain || b.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(b);
          if (out.length >= limit) break;
        }
      } catch (error) {
        console.warn(
          `[BrandService] getBrandSuggestions seed "${seeds[i]}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const sliced = out.slice(0, limit);
    return this.persistBrandfetchResultsToCatalog(sliced);
  }

  /**
   * Search brands by name.
   * Primary source: Brandfetch API.
   * Fallback: local DB fuzzy matching to avoid regressions if Brandfetch is unavailable.
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

    if (this.brandfetchEnabled) {
      try {
        const brandfetchResults = await this.searchBrandfetch(trimmedQuery, effectiveLimit);
        if (brandfetchResults.length > 0) {
          return brandfetchResults;
        }
      } catch (error) {
        // Fall back to DB search so existing flows continue to work.
        console.warn(
          `[BrandService] Brandfetch unavailable, using DB fallback: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
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
