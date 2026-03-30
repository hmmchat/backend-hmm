import { Injectable, Logger } from "@nestjs/common";
import fetch from "node-fetch";
import { RedisService } from "./redis.service.js";

export type GifProvider = "giphy";

export interface GifSearchItem {
  provider: GifProvider;
  id: string;
  url: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  title?: string;
}

@Injectable()
export class GiphyService {
  private readonly logger = new Logger(GiphyService.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly cacheTtlSeconds: number;

  constructor(private readonly redis: RedisService) {
    this.apiKey = process.env.GIPHY_API_KEY?.trim();
    this.baseUrl = process.env.GIPHY_BASE_URL?.trim() || "https://api.giphy.com/v1";
    this.cacheTtlSeconds = parseInt(process.env.GIF_SEARCH_CACHE_TTL_SECONDS || "3600", 10);
  }

  async search(
    q: string,
    opts: { limit: number; offset: number; rating?: string }
  ): Promise<{ provider: GifProvider; query: string; limit: number; offset: number; results: GifSearchItem[] }> {
    if (!this.apiKey) {
      throw new Error("GIPHY_API_KEY is not configured");
    }
    const query = q.trim();
    if (!query) {
      return { provider: "giphy", query: "", limit: opts.limit, offset: opts.offset, results: [] };
    }

    const rating = opts.rating?.trim() || undefined;
    const cacheKey = `gif:giphy:search:${encodeURIComponent(query)}:${opts.limit}:${opts.offset}:${rating || "-"}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // ignore cache parse errors
      }
    }

    const url = new URL(`${this.baseUrl}/gifs/search`);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(opts.limit));
    url.searchParams.set("offset", String(opts.offset));
    url.searchParams.set("lang", "en");
    if (rating) url.searchParams.set("rating", rating);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.warn(`GIPHY search failed: ${res.status} ${text}`);
      throw new Error(`GIPHY search failed (${res.status})`);
    }

    const json = (await res.json()) as any;
    const results: GifSearchItem[] = Array.isArray(json?.data)
      ? json.data.map((g: any) => {
          const id = String(g?.id || "");
          const images = g?.images || {};
          const original = images?.original || {};
          const fixed = images?.fixed_width_downsampled || images?.fixed_width || {};
          const url = String(original?.url || g?.url || "");
          const previewUrl = fixed?.url ? String(fixed.url) : undefined;
          const width = original?.width ? parseInt(String(original.width), 10) : undefined;
          const height = original?.height ? parseInt(String(original.height), 10) : undefined;
          const title = g?.title ? String(g.title) : undefined;
          return {
            provider: "giphy",
            id,
            url,
            previewUrl,
            width: Number.isFinite(width as any) ? width : undefined,
            height: Number.isFinite(height as any) ? height : undefined,
            title
          };
        }).filter((x: GifSearchItem) => x.id && x.url)
      : [];

    const payload = { provider: "giphy" as const, query, limit: opts.limit, offset: opts.offset, results };
    await this.redis.set(cacheKey, JSON.stringify(payload), this.cacheTtlSeconds);
    return payload;
  }

  /**
   * GIPHY trending GIFs (https://developers.giphy.com/docs/api/endpoint#get-trending-gifs)
   */
  async trending(opts: { limit: number; offset: number; rating?: string }): Promise<{
    provider: GifProvider;
    query: string;
    limit: number;
    offset: number;
    results: GifSearchItem[];
  }> {
    if (!this.apiKey) {
      throw new Error("GIPHY_API_KEY is not configured");
    }
    const rating = opts.rating?.trim() || undefined;
    const cacheKey = `gif:giphy:trending:${opts.limit}:${opts.offset}:${rating || "-"}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // ignore
      }
    }

    const url = new URL(`${this.baseUrl}/gifs/trending`);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("limit", String(opts.limit));
    url.searchParams.set("offset", String(opts.offset));
    if (rating) url.searchParams.set("rating", rating);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.warn(`GIPHY trending failed: ${res.status} ${text}`);
      throw new Error(`GIPHY trending failed (${res.status})`);
    }

    const json = (await res.json()) as any;
    const results: GifSearchItem[] = Array.isArray(json?.data)
      ? json.data
          .map((g: any) => {
            const id = String(g?.id || "");
            const images = g?.images || {};
            const original = images?.original || {};
            const fixed = images?.fixed_width_downsampled || images?.fixed_width || {};
            const gifUrl = String(original?.url || g?.url || "");
            const previewUrl = fixed?.url ? String(fixed.url) : undefined;
            const width = original?.width ? parseInt(String(original.width), 10) : undefined;
            const height = original?.height ? parseInt(String(original.height), 10) : undefined;
            const title = g?.title ? String(g.title) : undefined;
            return {
              provider: "giphy" as const,
              id,
              url: gifUrl,
              previewUrl,
              width: Number.isFinite(width as any) ? width : undefined,
              height: Number.isFinite(height as any) ? height : undefined,
              title
            };
          })
          .filter((x: GifSearchItem) => x.id && x.url)
      : [];

    const payload = {
      provider: "giphy" as const,
      query: "",
      limit: opts.limit,
      offset: opts.offset,
      results
    };
    await this.redis.set(cacheKey, JSON.stringify(payload), this.cacheTtlSeconds);
    return payload;
  }
}

