import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";
import { PrismaService } from "../prisma/prisma.service.js";
import { SEARCH_DEFAULT_LIMIT } from "../config/limits.config.js";

export interface SearchBrandResult {
  id: string;
  name: string;
  domain: string | null;
  logoUrl: string | null;
  /// Brandfetch brand id (from search payload). Used to generate stable Logo CDN URLs when `domain` is missing.
  brandfetchId?: string | null;
}

interface BrandfetchLogo {
  type?: string;
  theme?: string;
  formats?: Array<{ src?: string }>;
}

interface BrandfetchResult {
  name?: string;
  domain?: string;
  brandId?: string;
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

  /**
   * Public logo URL for clients. Brand Search API `asset.brandfetch.io` links expire after ~24h
   * (see Brand Search API guidelines); do not rely on those for stored or displayed URLs.
   * Logo API CDN URLs include the client id and stay valid for embedding.
   */
  resolvePublicLogoUrl(
    domain: string | null,
    storedLogoUrl: string | null,
    brandfetchId?: string | null
  ): string | null {
    const d = domain?.trim().toLowerCase();
    const bfid = brandfetchId?.trim();

    // If we can build Logo API CDN URLs, prefer that (stable vs Brand Search hotlink URLs).
    if (this.brandfetchClientId && (d || bfid)) {
      const identifier = d || bfid;
      return `https://cdn.brandfetch.io/${encodeURIComponent(identifier)}/icon.png?c=${encodeURIComponent(
        this.brandfetchClientId
      )}`;
    }

    // If the stored URL is a Brand Search API hotlink, it may be expired after ~24h.
    if (storedLogoUrl?.includes("asset.brandfetch.io")) return null;

    return storedLogoUrl ?? null;
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

  private domainKey(domain: string | null | undefined): string | null {
    return this.normalizeDomain(domain ?? undefined);
  }

  /**
   * Fuzzy search on content-managed brands only (dashboard catalog).
   */
  private async searchCustomBrandsDb(query: string, limit: number): Promise<SearchBrandResult[]> {
    let rows = await this.prisma.$queryRaw<SearchBrandResult[]>`
      SELECT
        id,
        name,
        domain,
        "logoUrl",
        "brandfetchId"
      FROM "brands"
      WHERE "isCustom" = true
        AND lower(name) % lower(${query})
      ORDER BY similarity(lower(name), lower(${query})) DESC, name ASC
      LIMIT ${limit};
    `;

    if (rows.length === 0) {
      rows = await this.prisma.$queryRaw<SearchBrandResult[]>`
        SELECT
          id,
          name,
          domain,
          "logoUrl",
          "brandfetchId"
        FROM "brands"
        WHERE "isCustom" = true
        ORDER BY similarity(lower(name), lower(${query})) DESC, name ASC
        LIMIT ${limit};
      `;
    }

    return rows;
  }

  private async searchBrandfetch(query: string, limit: number): Promise<SearchBrandResult[]> {
    const encodedQuery = encodeURIComponent(query);
    // Brandfetch Brand Search requires the client id in `?c=` for every request.
    const url = `https://api.brandfetch.io/v2/search/${encodedQuery}?c=${encodeURIComponent(this.brandfetchClientId)}`;

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
        const brandfetchId = item.brandId ?? null;
        const safeName = (item.name || "").trim();
        const syntheticId = domain
          ? `brandfetch:${domain}`
          : `brandfetch:${safeName.toLowerCase().replace(/\s+/g, "-")}`;

        return {
          id: syntheticId,
          name: safeName,
          domain,
          brandfetchId,
          logoUrl: this.resolvePublicLogoUrl(domain, this.getBrandfetchLogo(item), brandfetchId)
        };
      })
      .slice(0, limit);
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
          if (row.isCustom) {
            out.push({
              id: row.id,
              name: row.name,
              domain: row.domain,
              brandfetchId: row.brandfetchId,
              logoUrl: this.resolvePublicLogoUrl(row.domain, row.logoUrl, row.brandfetchId)
            });
            continue;
          }

          const nextLogo =
            r.logoUrl ??
            (row.logoUrl?.includes("asset.brandfetch.io") ? null : row.logoUrl);
          const updated = await this.prisma.brand.update({
            where: { id: row.id },
            data: {
              logoUrl: nextLogo,
              domain: r.domain ?? row.domain,
              brandfetchId: r.brandfetchId ?? row.brandfetchId
            }
          });
          out.push({
            id: updated.id,
            name: updated.name,
            domain: updated.domain,
            brandfetchId: updated.brandfetchId,
            logoUrl: this.resolvePublicLogoUrl(updated.domain, updated.logoUrl, updated.brandfetchId)
          });
          continue;
        }

        const created = await this.prisma.brand.create({
          data: {
            name: r.name,
            domain: r.domain,
            logoUrl: r.logoUrl,
            isCustom: false,
            brandfetchId: r.brandfetchId ?? null
          }
        });
        out.push({
          id: created.id,
          name: created.name,
          domain: created.domain,
          brandfetchId: created.brandfetchId,
          logoUrl: this.resolvePublicLogoUrl(created.domain, created.logoUrl, created.brandfetchId)
        });
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") {
          const fallback = await this.prisma.brand.findFirst({
            where: { name: { equals: r.name, mode: "insensitive" } }
          });
          if (fallback) {
            if (fallback.isCustom) {
              out.push({
                id: fallback.id,
                name: fallback.name,
                domain: fallback.domain,
                brandfetchId: fallback.brandfetchId,
                logoUrl: this.resolvePublicLogoUrl(fallback.domain, fallback.logoUrl, fallback.brandfetchId)
              });
            } else {
              out.push({
                id: fallback.id,
                name: fallback.name,
                domain: fallback.domain,
                brandfetchId: r.brandfetchId ?? fallback.brandfetchId,
                logoUrl: this.resolvePublicLogoUrl(
                  fallback.domain,
                  r.logoUrl ?? fallback.logoUrl,
                  r.brandfetchId ?? fallback.brandfetchId
                )
              });
            }
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
   * Random content-managed brands when Brandfetch is off or as filler.
   */
  private async getCustomBrandSuggestionsOnly(limit: number): Promise<SearchBrandResult[]> {
    const rows = await this.prisma.$queryRaw<SearchBrandResult[]>`
      SELECT
        id,
        name,
        domain,
        "logoUrl",
        "brandfetchId"
      FROM "brands"
      WHERE "isCustom" = true
      ORDER BY random()
      LIMIT ${limit};
    `;
    return rows.map(r => ({
      ...r,
      logoUrl: this.resolvePublicLogoUrl(r.domain, r.logoUrl, r.brandfetchId)
    }));
  }

  /**
   * Suggested brands for the "pick brands" screen (GET /brands).
   * Merges Brandfetch results with content-managed DB brands (deduped by domain).
   */
  async getBrandSuggestions(limit: number): Promise<SearchBrandResult[]> {
    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    if (!this.brandfetchEnabled) {
      return this.getCustomBrandSuggestionsOnly(limit);
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
    if (sliced.length === 0) {
      return this.getCustomBrandSuggestionsOnly(limit);
    }

    const persisted = await this.persistBrandfetchResultsToCatalog(sliced);
    const bfDomains = new Set(
      persisted.map(b => this.domainKey(b.domain)).filter((v): v is string => !!v)
    );

    const customPool = await this.prisma.$queryRaw<SearchBrandResult[]>`
      SELECT
        id,
        name,
        domain,
        "logoUrl",
        "brandfetchId"
      FROM "brands"
      WHERE "isCustom" = true
      ORDER BY random()
      LIMIT ${Math.min(50, limit * 3)}
    `;

    const customExtra = customPool.filter(c => {
      const dk = this.domainKey(c.domain);
      if (!dk) return true;
      return !bfDomains.has(dk);
    });

    const merged: SearchBrandResult[] = [];
    const idSeen = new Set<string>();
    for (const b of persisted) {
      const row = {
        ...b,
        logoUrl: this.resolvePublicLogoUrl(b.domain, b.logoUrl, b.brandfetchId)
      };
      if (idSeen.has(row.id)) continue;
      idSeen.add(row.id);
      merged.push(row);
      if (merged.length >= limit) break;
    }
    for (const c of customExtra) {
      if (merged.length >= limit) break;
      if (idSeen.has(c.id)) continue;
      idSeen.add(c.id);
      merged.push({
        ...c,
        logoUrl: this.resolvePublicLogoUrl(c.domain, c.logoUrl, c.brandfetchId)
      });
    }

    return merged.slice(0, limit);
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
          const bfPersisted = await this.persistBrandfetchResultsToCatalog(brandfetchResults);
          const bfDomainSet = new Set(
            bfPersisted.map(b => this.domainKey(b.domain)).filter((v): v is string => !!v)
          );

          const customRows = await this.searchCustomBrandsDb(trimmedQuery, effectiveLimit);
          const customFiltered = customRows.filter(c => {
            const dk = this.domainKey(c.domain);
            if (!dk) return true;
            return !bfDomainSet.has(dk);
          });

          const merged: SearchBrandResult[] = [];
          const seen = new Set<string>();
          for (const b of bfPersisted) {
            const row = {
              ...b,
              logoUrl: this.resolvePublicLogoUrl(b.domain, b.logoUrl, b.brandfetchId)
            };
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            merged.push(row);
            if (merged.length >= effectiveLimit) break;
          }
          for (const c of customFiltered) {
            if (merged.length >= effectiveLimit) break;
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            merged.push({
              ...c,
              logoUrl: this.resolvePublicLogoUrl(c.domain, c.logoUrl, c.brandfetchId)
            });
          }
          return merged.slice(0, effectiveLimit);
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

    // Brandfetch off / failed / no hits: prefer content-managed brands, then entire catalog.
    let brands = await this.searchCustomBrandsDb(trimmedQuery, effectiveLimit);
    if (brands.length === 0) {
      brands = await this.prisma.$queryRaw<SearchBrandResult[]>`
        SELECT
          id,
          name,
          domain,
          "logoUrl",
          "brandfetchId"
        FROM "brands"
        WHERE lower(name) % lower(${trimmedQuery})
        ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
        LIMIT ${effectiveLimit};
      `;
    }

    if (brands.length === 0) {
      brands = await this.prisma.$queryRaw<SearchBrandResult[]>`
        SELECT
          id,
          name,
          domain,
          "logoUrl",
          "brandfetchId"
        FROM "brands"
        ORDER BY similarity(lower(name), lower(${trimmedQuery})) DESC, name ASC
        LIMIT ${effectiveLimit};
      `;
    }

    return brands.map(b => ({
      ...b,
      logoUrl: this.resolvePublicLogoUrl(b.domain, b.logoUrl, b.brandfetchId)
    }));
  }
}
