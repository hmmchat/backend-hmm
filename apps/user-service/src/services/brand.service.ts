import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import fetch from "node-fetch";
import { rewriteExpiredStorageUrl } from "@hmm/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { SEARCH_DEFAULT_LIMIT } from "../config/limits.config.js";
import {
  catalogFuzzyFallbackOrderBy,
  catalogFuzzyOrderBy,
  catalogFuzzyWhere
} from "../utils/catalog-fuzzy-search.js";

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

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
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
   * Public logo URL for clients.
   * - Dashboard / uploaded logos (B2/S3, etc.) always win over Brandfetch.
   * - Brand Search API icons (`asset.brandfetch.io` and signed `cdn.brandfetch.io/...?...`
   *   tokens) expire — never serve those; rewrite to Logo Link with our client id.
   * - Stable form: `cdn.brandfetch.io/{domain|brandfetchId}/icon.png?c={CLIENT_ID}`.
   */
  resolvePublicLogoUrl(
    domain: string | null,
    storedLogoUrl: string | null,
    brandfetchId?: string | null
  ): string | null {
    const stored = storedLogoUrl?.trim() || null;
    const isBrandfetchUrl =
      !!stored &&
      (stored.includes("asset.brandfetch.io") || stored.includes("cdn.brandfetch.io"));

    // Uploaded or otherwise persisted logos override Brandfetch CDN.
    // (Custom "Beam" with a dashboard upload must not be replaced by onbeam.com's icon.)
    if (stored && !isBrandfetchUrl) {
      return rewriteExpiredStorageUrl(stored);
    }

    let d = domain?.trim().toLowerCase() || null;
    let bfid = brandfetchId?.trim() || null;

    // Recover identifier from a stored Brandfetch CDN path when the row is incomplete
    // (common for city-catalog brands persisted from search icons).
    if (!d && !bfid && stored?.includes("cdn.brandfetch.io")) {
      try {
        const first = new URL(stored).pathname.split("/").filter(Boolean)[0];
        if (first) {
          if (first.includes(".")) d = first.toLowerCase();
          else bfid = first;
        }
      } catch {
        // ignore malformed stored URLs
      }
    }

    if (this.brandfetchClientId && (d || bfid)) {
      const identifier = d || bfid!;
      return `https://cdn.brandfetch.io/${encodeURIComponent(identifier)}/icon.png?c=${encodeURIComponent(
        this.brandfetchClientId
      )}`;
    }

    // Don't serve known-expiring Brandfetch search icons.
    return null;
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

  private brandNameKey(name: string | null | undefined): string | null {
    const n = (name || "").trim().toLowerCase().replace(/\s+/g, " ");
    return n || null;
  }

  /** Dedupe keys for a brand row (domain, normalized name, brandfetchId, id). */
  private brandDedupeKeys(brand: SearchBrandResult): string[] {
    const keys: string[] = [];
    const domain = this.domainKey(brand.domain);
    const name = this.brandNameKey(brand.name);
    const bfid = brand.brandfetchId?.trim();
    if (domain) keys.push(`d:${domain}`);
    if (name) keys.push(`n:${name}`);
    if (bfid) keys.push(`b:${bfid}`);
    if (brand.id) keys.push(`i:${brand.id}`);
    return keys;
  }

  private dedupeBrandResults(brands: SearchBrandResult[]): SearchBrandResult[] {
    const seen = new Set<string>();
    const out: SearchBrandResult[] = [];
    for (const brand of brands) {
      if (!brand?.name) continue;
      const keys = this.brandDedupeKeys(brand);
      if (keys.some((key) => seen.has(key))) continue;
      for (const key of keys) seen.add(key);
      out.push(brand);
    }
    return out;
  }

  /**
   * Prefer the Brandfetch hit that best matches the seed name, then a few neighbors.
   * Avoids stuffing every seed’s full noisy result list (duplicates + off-category brands).
   */
  private pickBrandsForSeed(seed: string, chunk: SearchBrandResult[], maxPerSeed = 3): SearchBrandResult[] {
    if (chunk.length === 0) return [];
    const seedKey = this.brandNameKey(seed) || seed.toLowerCase();
    const scored = chunk.map((brand, index) => {
      const name = this.brandNameKey(brand.name) || "";
      let score = 0;
      if (name === seedKey) score += 100;
      else if (name.startsWith(seedKey) || seedKey.startsWith(name)) score += 60;
      else if (name.includes(seedKey) || seedKey.includes(name)) score += 30;
      score -= index; // preserve Brandfetch rank as a light tiebreaker
      return { brand, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxPerSeed).map((row) => row.brand);
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
        AND (${catalogFuzzyWhere(query)})
      ORDER BY ${catalogFuzzyOrderBy(query)}
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
          AND GREATEST(
            similarity(lower(name), lower(${query})),
            word_similarity(lower(${query}), lower(name))
          ) >= 0.12
        ORDER BY ${catalogFuzzyFallbackOrderBy(query)}
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
   * Brandfetch browse categories (website taxonomy). "Featured" is intentionally omitted.
   * Brand Search has no industry filter — each set uses several well-known brand seeds
   * so we get real category brands (Netflix, Disney, …) instead of name-matches for
   * the word "entertainment".
   */
  private brandfetchBrowseSets(): { name: string; query: string; seeds: string[] }[] {
    return [
      {
        name: "Technology",
        query: "technology",
        seeds: [
          "apple",
          "google",
          "microsoft",
          "amazon",
          "samsung",
          "meta",
          "nvidia",
          "intel",
          "ibm",
          "oracle",
          "adobe",
          "salesforce"
        ]
      },
      {
        name: "Arts and Entertainment",
        query: "entertainment",
        seeds: [
          "netflix",
          "disney",
          "spotify",
          "youtube",
          "hbo",
          "pixar",
          "marvel",
          "universal",
          "warner",
          "paramount",
          "sony pictures",
          "prime video"
        ]
      },
      {
        name: "Finance",
        query: "finance",
        seeds: [
          "visa",
          "mastercard",
          "paypal",
          "stripe",
          "chase",
          "amex",
          "hsbc",
          "goldman",
          "revolut",
          "wise",
          "razorpay",
          "paytm"
        ]
      },
      {
        name: "Food and Drink",
        query: "food",
        seeds: [
          "starbucks",
          "mcdonalds",
          "coca cola",
          "pepsi",
          "nestle",
          "kfc",
          "dominos",
          "subway",
          "red bull",
          "heineken",
          "chipotle",
          "dunkin"
        ]
      },
      {
        name: "Vehicles",
        query: "automotive",
        seeds: [
          "tesla",
          "toyota",
          "bmw",
          "mercedes",
          "ford",
          "honda",
          "audi",
          "porsche",
          "hyundai",
          "volkswagen",
          "ferrari",
          "tata motors"
        ]
      },
      {
        name: "Travel and tourism",
        query: "travel",
        seeds: [
          "airbnb",
          "booking",
          "expedia",
          "uber",
          "marriott",
          "hilton",
          "emirates",
          "delta",
          "tripadvisor",
          "makemytrip",
          "indigo",
          "qatar airways"
        ]
      },
      {
        name: "Shopping",
        query: "retail",
        seeds: [
          "amazon",
          "walmart",
          "target",
          "ikea",
          "costco",
          "ebay",
          "etsy",
          "flipkart",
          "myntra",
          "shopify",
          "best buy",
          "alibaba"
        ]
      },
      {
        name: "Fashion",
        query: "fashion",
        seeds: [
          "nike",
          "adidas",
          "zara",
          "gucci",
          "h&m",
          "uniqlo",
          "louis vuitton",
          "prada",
          "puma",
          "levi",
          "chanel",
          "shein"
        ]
      },
      {
        name: "Sports",
        query: "sports",
        seeds: [
          "nike",
          "adidas",
          "puma",
          "under armour",
          "reebok",
          "nba",
          "fifa",
          "espn",
          "decathlon",
          "wilson",
          "new balance",
          "asics"
        ]
      },
      {
        name: "Beauty",
        query: "beauty",
        seeds: [
          "sephora",
          "loreal",
          "mac",
          "nykaa",
          "estee lauder",
          "maybelline",
          "clinique",
          "ulta",
          "the ordinary",
          "fenty",
          "nivea",
          "dove"
        ]
      },
      {
        name: "Media",
        query: "media",
        seeds: [
          "nyt",
          "bbc",
          "cnn",
          "forbes",
          "bloomberg",
          "reuters",
          "times of india",
          "the guardian",
          "wsj",
          "buzzfeed",
          "vice",
          "spotify"
        ]
      },
      {
        name: "Healthcare",
        query: "healthcare",
        seeds: [
          "pfizer",
          "johnson",
          "cvs",
          "unitedhealth",
          "apollo",
          "pharmeasy",
          "1mg",
          "abbott",
          "novartis",
          "roche",
          "mayo clinic",
          "practo"
        ]
      },
      {
        name: "Gaming",
        query: "gaming",
        seeds: [
          "playstation",
          "xbox",
          "nintendo",
          "steam",
          "epic games",
          "roblox",
          "riot",
          "activision",
          "ubisoft",
          "ea",
          "blizzard",
          "twitch"
        ]
      },
      {
        name: "Education",
        query: "education",
        seeds: [
          "coursera",
          "duolingo",
          "khan academy",
          "udemy",
          "byju",
          "unacademy",
          "chegg",
          "quizlet",
          "edx",
          "skillshare",
          "linkedin learning",
          "pearson"
        ]
      }
    ];
  }

  private resolveBrowseSet(
    category: string
  ): { name: string; query: string; seeds: string[] } | null {
    const needle = category.trim().toLowerCase();
    if (!needle) return null;
    return (
      this.brandfetchBrowseSets().find(
        (set) => set.name.toLowerCase() === needle || set.query.toLowerCase() === needle
      ) || null
    );
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
    return this.brandfetchBrowseSets().flatMap((set) => set.seeds.slice(0, 2));
  }

  /** Distinct Brandfetch category sets for the brands picker (no Featured). */
  getBrandSets(): { sets: { name: string }[] } {
    return { sets: this.brandfetchBrowseSets().map((set) => ({ name: set.name })) };
  }

  /**
   * Brands inside a Brandfetch category set. Brandfetch-only (dashboard catalog is search-only).
   * Fans out seed searches in parallel (Brandfetch has no list-by-industry API), keeps the
   * best hits per seed, and dedupes by domain/name/brandfetchId so the same brand cannot
   * stick across pages.
   */
  async getBrandsByCategory(category: string, limit: number = 50): Promise<SearchBrandResult[]> {
    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    const set = this.resolveBrowseSet(category);
    if (!set) {
      throw new HttpException("Unknown brand category", HttpStatus.BAD_REQUEST);
    }

    if (!this.brandfetchEnabled) {
      return [];
    }

    const seeds = this.shuffle([...set.seeds]).slice(0, 8);
    const chunks = await Promise.all(
      seeds.map(async (seed) => {
        try {
          const chunk = await this.searchBrandfetch(seed, 8);
          return this.pickBrandsForSeed(seed, chunk, 3);
        } catch (error) {
          console.warn(
            `[BrandService] getBrandsByCategory seed "${seed}" failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return [] as SearchBrandResult[];
        }
      })
    );

    let merged = this.dedupeBrandResults(chunks.flat());

    if (merged.length === 0) {
      try {
        merged = await this.searchBrandfetch(set.query, limit);
      } catch (error) {
        console.warn(
          `[BrandService] getBrandsByCategory "${set.name}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return [];
      }
    }

    if (merged.length === 0) return [];

    const persisted = await this.persistBrandfetchResultsToCatalog(merged.slice(0, limit));
    return this.dedupeBrandResults(persisted).slice(0, limit);
  }

  /**
   * Resolve a Brandfetch category query for “similar” fill from top matches.
   */
  private async resolveSimilarCategoryQuery(
    matches: SearchBrandResult[],
    originalQuery: string
  ): Promise<string | null> {
    const sets = this.brandfetchBrowseSets();

    for (const match of matches) {
      const domain = this.normalizeDomain(match.domain ?? undefined);
      if (!domain) continue;
      try {
        const url = `https://api.brandfetch.io/v2/brands/domain/${encodeURIComponent(
          domain
        )}/company/industries`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.brandfetchClientId}` }
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          industries?: Array<{
            name?: string;
            slug?: string;
            parent?: { name?: string; slug?: string } | string | null;
          }>;
        };
        const industries = Array.isArray(payload?.industries) ? payload.industries : [];
        const labels: string[] = [];
        for (const industry of industries) {
          if (industry?.name) labels.push(industry.name);
          if (industry?.slug) labels.push(industry.slug.replace(/-/g, " "));
          const parent = industry?.parent;
          if (typeof parent === "string") labels.push(parent);
          else if (parent?.name) labels.push(parent.name);
          else if (parent?.slug) labels.push(parent.slug.replace(/-/g, " "));
        }
        for (const label of labels) {
          const lower = label.toLowerCase();
          const hit = sets.find(
            (set) =>
              lower.includes(set.query) ||
              lower.includes(set.name.toLowerCase()) ||
              set.name.toLowerCase().includes(lower) ||
              set.query.includes(lower)
          );
          if (hit) return hit.query;
        }
      } catch (error) {
        console.warn(
          `[BrandService] industries lookup failed for ${domain}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const q = originalQuery.toLowerCase();
    const byQuery = sets.find(
      (set) => q.includes(set.query) || set.query.includes(q) || q.includes(set.name.toLowerCase())
    );
    return byQuery?.query ?? null;
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
   * Higher = better match. Exact/local catalog hits must beat weak Brandfetch noise
   * (e.g. query "UPI" should surface the dashboard "upi" brand first).
   */
  private brandSearchScore(name: string, query: string, fromCustomCatalog: boolean): number {
    const n = name.trim().toLowerCase();
    const q = query.trim().toLowerCase();
    let score = 0;
    if (n === q) score = 1000;
    else if (n.startsWith(q)) score = 500;
    else if (n.includes(q)) score = 250;
    else if (n.replace(/\s+/g, "") === q.replace(/\s+/g, "")) score = 400;
    else {
      const dist = levenshtein(n, q);
      const maxLen = Math.max(n.length, q.length, 1);
      score = dist <= Math.max(1, Math.floor(maxLen * 0.34)) ? 120 : 1;
    }
    // Prefer content-managed brands within the same match tier.
    if (fromCustomCatalog) score += 50;
    return score;
  }

  private rankBrandSearchResults(
    query: string,
    rows: SearchBrandResult[],
    customIds: Set<string>
  ): SearchBrandResult[] {
    return [...rows].sort((a, b) => {
      const sa = this.brandSearchScore(a.name, query, customIds.has(a.id));
      const sb = this.brandSearchScore(b.name, query, customIds.has(b.id));
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name);
    });
  }

  /** Exact name hits from the local catalog (custom + imported). */
  private async findExactBrandMatches(
    query: string
  ): Promise<{ rows: SearchBrandResult[]; customIds: Set<string> }> {
    const rows = await this.prisma.brand.findMany({
      where: {
        OR: [
          { name: { equals: query, mode: "insensitive" } },
          { name: { startsWith: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } }
        ]
      },
      select: {
        id: true,
        name: true,
        domain: true,
        logoUrl: true,
        brandfetchId: true,
        isCustom: true
      },
      take: 20
    });
    const customIds = new Set(rows.filter((b) => b.isCustom).map((b) => b.id));
    return {
      customIds,
      rows: rows.map((b) => ({
        id: b.id,
        name: b.name,
        domain: b.domain,
        brandfetchId: b.brandfetchId,
        logoUrl: this.resolvePublicLogoUrl(b.domain, b.logoUrl, b.brandfetchId)
      }))
    };
  }

  /**
   * Search brands by name.
   * Merges Brandfetch + local catalog, ranked so exact/local matches win
   * (Brandfetch alone often ranks poorly for India-specific names like UPI).
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

    const { rows: exactRows, customIds: exactCustomIds } =
      await this.findExactBrandMatches(trimmedQuery);

    if (this.brandfetchEnabled) {
      try {
        const brandfetchResults = await this.searchBrandfetch(trimmedQuery, effectiveLimit);
        if (brandfetchResults.length > 0 || exactRows.length > 0) {
          const bfPersisted =
            brandfetchResults.length > 0
              ? await this.persistBrandfetchResultsToCatalog(brandfetchResults)
              : [];
          const bfDomainSet = new Set(
            bfPersisted.map((b) => this.domainKey(b.domain)).filter((v): v is string => !!v)
          );

          const customRows = await this.searchCustomBrandsDb(trimmedQuery, effectiveLimit);
          const customFiltered = customRows.filter((c) => {
            const dk = this.domainKey(c.domain);
            if (!dk) return true;
            return !bfDomainSet.has(dk);
          });

          const customIds = new Set<string>([
            ...exactCustomIds,
            ...customFiltered.map((c) => c.id)
          ]);

          const merged: SearchBrandResult[] = [];
          const seen = new Set<string>();
          const pushRow = (row: SearchBrandResult) => {
            if (seen.has(row.id)) return;
            seen.add(row.id);
            merged.push({
              ...row,
              logoUrl: this.resolvePublicLogoUrl(row.domain, row.logoUrl, row.brandfetchId)
            });
          };

          // Exact local hits first in the pool (ranking will keep them on top).
          for (const row of exactRows) pushRow(row);
          for (const b of bfPersisted) pushRow(b);
          for (const c of customFiltered) pushRow(c);

          const ranked = this.rankBrandSearchResults(trimmedQuery, merged, customIds);
          return this.appendSameCategorySimilar(trimmedQuery, ranked, effectiveLimit);
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
        WHERE ${catalogFuzzyWhere(trimmedQuery)}
        ORDER BY ${catalogFuzzyOrderBy(trimmedQuery)}
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
        WHERE GREATEST(
          similarity(lower(name), lower(${trimmedQuery})),
          word_similarity(lower(${trimmedQuery}), lower(name))
        ) >= 0.12
        ORDER BY ${catalogFuzzyFallbackOrderBy(trimmedQuery)}
        LIMIT ${effectiveLimit};
      `;
    }

    const mapped = [...exactRows];
    const seen = new Set(mapped.map((b) => b.id));
    for (const b of brands) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      mapped.push({
        ...b,
        logoUrl: this.resolvePublicLogoUrl(b.domain, b.logoUrl, b.brandfetchId)
      });
    }

    const customIds = new Set(
      (
        await this.prisma.brand.findMany({
          where: { id: { in: mapped.map((b) => b.id) }, isCustom: true },
          select: { id: true }
        })
      ).map((r) => r.id)
    );

    const ranked = this.rankBrandSearchResults(trimmedQuery, mapped, customIds);
    return this.appendSameCategorySimilar(trimmedQuery, ranked, effectiveLimit);
  }

  /**
   * After ranked matches, fill remaining slots with Brandfetch brands from the same category.
   */
  private async appendSameCategorySimilar(
    query: string,
    ranked: SearchBrandResult[],
    limit: number
  ): Promise<SearchBrandResult[]> {
    if (!this.brandfetchEnabled || ranked.length >= limit) {
      return ranked.slice(0, limit);
    }

    const similarQuery = await this.resolveSimilarCategoryQuery(ranked, query);
    if (!similarQuery) {
      return ranked.slice(0, limit);
    }

    try {
      const similarRaw = await this.searchBrandfetch(similarQuery, limit);
      if (similarRaw.length === 0) {
        return ranked.slice(0, limit);
      }
      const similar = await this.persistBrandfetchResultsToCatalog(similarRaw);
      const seen = new Set(ranked.map((b) => b.id));
      const out = [...ranked];
      for (const brand of similar) {
        if (!brand?.id || seen.has(brand.id)) continue;
        seen.add(brand.id);
        out.push({
          ...brand,
          logoUrl: this.resolvePublicLogoUrl(brand.domain, brand.logoUrl, brand.brandfetchId)
        });
        if (out.length >= limit) break;
      }
      return out.slice(0, limit);
    } catch (error) {
      console.warn(
        `[BrandService] similar category fill failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return ranked.slice(0, limit);
    }
  }
}
