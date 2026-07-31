/**
 * Hosted embedding adapter — cost-friendly provider behind the
 * provider-neutral EmbeddingProvider interface.
 *
 * Design goals:
 * - No PII sent to the provider: only de-identified matchmaking text
 * - Deterministic caching by SHA-256 of the exact input text
 * - Per-call cost tracking using provider-reported token counts
 * - Hard budget gate via CostTrackerService
 * - Never present hash fallback as semantic (callers get provider tag)
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { CacheService } from "../cache.service.js";
import { EmbeddingProvider } from "../embedding-provider.interface.js";
import { CostTrackerService } from "../cost-tracker.service.js";

export type EmbeddingProviderKind = "hosted" | "fallback";

export interface EmbeddingResult {
  vector: number[];
  provider: EmbeddingProviderKind;
}

interface HostedEmbeddingConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  maxBatchSize: number;
  costPer1kTokens: number; // INR
}

/**
 * Deterministic hash vector — NOT semantic. Same text → same vector only.
 * Callers must tag stored features as provider=fallback and skip cosine intent scoring.
 */
class DeterministicFallbackProvider {
  readonly name = "deterministic-fallback";

  generate(text: string): number[] {
    return this.embed(text);
  }

  generateBatch(texts: string[]): number[][] {
    return texts.map((t) => this.embed(t));
  }

  private embed(text: string): number[] {
    const hash = createHash("sha256").update(text).digest();
    const vector: number[] = new Array(384).fill(0);
    for (let i = 0; i < 384; i++) {
      const b1 = hash[i % 32];
      const b2 = hash[(i + 1) % 32];
      const b3 = hash[(i + 7) % 32];
      vector[i] = ((b1 * 1315423911) ^ (b2 * 2654435761) ^ (b3 * 97531)) / 2 ** 32;
    }
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}

@Injectable()
export class HostedEmbeddingAdapter implements EmbeddingProvider {
  private readonly logger = new Logger(HostedEmbeddingAdapter.name);
  private readonly cfg: HostedEmbeddingConfig;
  private readonly fallback = new DeterministicFallbackProvider();
  private paused = false;

  constructor(
    private readonly cache: CacheService,
    private readonly costTracker: CostTrackerService
  ) {
    const configService = new ConfigService();
    this.cfg = {
      apiUrl: configService.get<string>("EMBEDDING_API_URL") || "https://api.openai.com/v1/embeddings",
      apiKey: configService.get<string>("EMBEDDING_API_KEY") || "",
      model: configService.get<string>("EMBEDDING_MODEL") || "text-embedding-3-small",
      dimensions: configService.get<number>("EMBEDDING_DIMENSIONS") || 512,
      maxBatchSize: configService.get<number>("EMBEDDING_MAX_BATCH") || 100,
      costPer1kTokens: configService.get<number>("EMBEDDING_COST_PER_1K_INR") || 0.01
    };
  }

  get name(): string {
    return this.paused ? `${this.cfg.model}-paused` : this.cfg.model;
  }

  get estimatedCostPer1kTokensInr(): number {
    return this.cfg.costPer1kTokens;
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    this.logger.log(`Hosted embeddings ${paused ? "PAUSED" : "RESUMED"}`);
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Intent-only de-identified text for the semantic intent weight. */
  static buildIntentText(intent?: string | null): string {
    return (intent || "").trim();
  }

  /**
   * Legacy concatenated profile text (kept for checksum migrations / debugging).
   * Prefer buildIntentText for new feature generation.
   */
  static buildDeidentifiedText(profile: {
    intent?: string | null;
    interestNames?: string[];
    valueNames?: string[];
    songName?: string | null;
    brandNames?: string[];
  }): string {
    const parts: string[] = [];
    if (profile.intent?.trim()) parts.push(`intent: ${profile.intent.trim()}`);
    if (profile.interestNames?.length) parts.push(`interests: ${profile.interestNames.join(", ")}`);
    if (profile.valueNames?.length) parts.push(`values: ${profile.valueNames.join(", ")}`);
    if (profile.songName?.trim()) parts.push(`song: ${profile.songName.trim()}`);
    if (profile.brandNames?.length) parts.push(`brands: ${profile.brandNames.join(", ")}`);
    return parts.join(" | ");
  }

  async generate(text: string): Promise<number[]> {
    const result = await this.generateWithMeta(text);
    return result.vector;
  }

  async generateWithMeta(text: string): Promise<EmbeddingResult> {
    const results = await this.generateBatchWithMeta([text]);
    return results[0];
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    const results = await this.generateBatchWithMeta(texts);
    return results.map((r) => r.vector);
  }

  async generateBatchWithMeta(texts: string[]): Promise<EmbeddingResult[]> {
    if (this.paused || !this.cfg.apiKey) {
      this.logger.debug("Embeddings paused or no API key — using non-semantic fallback");
      return this.fallback.generateBatch(texts).map((vector) => ({ vector, provider: "fallback" as const }));
    }

    const canAfford = await this.costTracker.canAfford(0.0001);
    if (!canAfford) {
      this.logger.warn("Embedding budget exhausted — using non-semantic fallback");
      return this.fallback.generateBatch(texts).map((vector) => ({ vector, provider: "fallback" as const }));
    }

    const cached = new Map<string, number[]>();
    const uncached: string[] = [];
    const uncachedIdx: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const key = this.cacheKey(texts[i]);
      const hit = await this.cache.get<number[]>(key);
      if (hit) {
        cached.set(texts[i], hit);
      } else {
        uncached.push(texts[i]);
        uncachedIdx.push(i);
      }
    }

    const results: EmbeddingResult[] = new Array(texts.length);
    for (const [text, vector] of cached) {
      results[texts.indexOf(text)] = { vector, provider: "hosted" };
    }

    if (uncached.length === 0) {
      return results;
    }

    for (let i = 0; i < uncached.length; i += this.cfg.maxBatchSize) {
      const chunk = uncached.slice(i, i + this.cfg.maxBatchSize);
      const estimatedTokens = chunk.reduce((s, t) => s + Math.ceil(t.length / 4), 0);
      const estimatedCost = (estimatedTokens / 1000) * this.cfg.costPer1kTokens;
      if (!(await this.costTracker.canAfford(estimatedCost))) {
        this.logger.warn("Embedding budget would be exceeded for batch — fallback for remainder");
        for (let j = i; j < uncached.length; j++) {
          const idx = uncachedIdx[j];
          results[idx] = { vector: this.fallback.generate(uncached[j]), provider: "fallback" };
        }
        break;
      }

      try {
        const embeddings = await this.callProvider(chunk);
        embeddings.forEach((emb, j) => {
          const idx = uncachedIdx[i + j];
          results[idx] = { vector: emb, provider: "hosted" };
          void this.cache.set(this.cacheKey(uncached[i + j]), emb, 86400);
        });
      } catch (err) {
        this.logger.warn(`Embedding API call failed, falling back: ${err}`);
        for (let j = 0; j < chunk.length; j++) {
          const idx = uncachedIdx[i + j];
          results[idx] = { vector: this.fallback.generate(chunk[j]), provider: "fallback" };
        }
      }
    }

    return results;
  }

  private cacheKey(text: string): string {
    return `embedding:v1:${this.cfg.model}:${this.cfg.dimensions}:${createHash("sha256").update(text).digest("hex")}`;
  }

  private async callProvider(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(this.cfg.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.cfg.model,
          input: texts,
          dimensions: this.cfg.dimensions,
          encoding_format: "float"
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`Embedding API ${res.status}: ${err}`);
      }

      const data: any = await res.json();
      const embeddings = data.data.map((d: any) => d.embedding);

      const totalTokens =
        data.usage?.prompt_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0);
      await this.costTracker.record(totalTokens, this.cfg.model, this.cfg.costPer1kTokens);

      return embeddings;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
}
