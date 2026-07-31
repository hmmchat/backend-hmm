/**
 * Admin controller for matchmaking pipeline control and observability.
 * Protected by AdminAuthGuard (X-Admin-Token header).
 */
import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards
} from "@nestjs/common";
import { CostTrackerService } from "../services/cost-tracker.service.js";
import { BatchAllocatorService } from "../services/batch-allocator.service.js";
import { SemanticScorerService } from "../services/semantic-scorer.service.js";
import { DiscoveryService } from "../services/discovery.service.js";
import { HostedEmbeddingAdapter } from "../services/embedding-adapters/hosted.adapter.js";
import { AdminAuthGuard } from "../guards/admin-auth.guard.js";
import {
  MATCHING_MODE,
  MATCHING_SEMANTIC_ENABLED,
  MATCHING_CANARY_CITIES
} from "../config/matching-admin.config.js";

@Controller("discovery/admin/matching")
@UseGuards(AdminAuthGuard)
export class MatchingAdminController {
  constructor(
    private readonly costTracker: CostTrackerService,
    private readonly allocator: BatchAllocatorService,
    private readonly semanticScorer: SemanticScorerService,
    private readonly discoveryService: DiscoveryService,
    private readonly embeddingAdapter: HostedEmbeddingAdapter
  ) {}

  /**
   * GET /discovery/admin/matching/status
   */
  @Get("status")
  async getStatus() {
    const [totalCost, dailyBreakdown, budgetStatus, featureCoverage, jobStats] = await Promise.all([
      this.costTracker.getTotal(),
      this.costTracker.getDailyBreakdown(),
      this.costTracker.getSnapshot(),
      this.semanticScorer.getCoverageStats(),
      this.discoveryService.getFeatureJobStats()
    ]);

    const allocatorState = this.allocator.getState();

    return {
      paused: allocatorState.paused,
      mode: MATCHING_MODE,
      semanticEnabled: MATCHING_SEMANTIC_ENABLED,
      canaryCities: MATCHING_CANARY_CITIES,
      embeddingsPaused: this.embeddingAdapter.isPaused(),
      totalCostInr: totalCost,
      dailyBreakdown,
      budget: budgetStatus,
      poolSize: allocatorState.lastPoolSize,
      lastAllocationAt: allocatorState.lastAllocationAt,
      lastShadowPairCount: allocatorState.lastShadowPairCount,
      usersWithFeatures: featureCoverage.withFeatures,
      usersWithoutFeatures: featureCoverage.withoutFeatures,
      hostedFeatures: featureCoverage.hosted,
      fallbackFeatures: featureCoverage.fallback,
      jobs: jobStats
    };
  }

  /**
   * POST /discovery/admin/matching/pause
   */
  @Post("pause")
  @HttpCode(HttpStatus.OK)
  async pause() {
    await this.allocator.pause();
    return { paused: true, message: "Batch allocator and embeddings paused" };
  }

  /**
   * POST /discovery/admin/matching/resume
   */
  @Post("resume")
  @HttpCode(HttpStatus.OK)
  async resume() {
    await this.allocator.resume();
    return { paused: false, message: "Batch allocator and embeddings resumed" };
  }

  /**
   * POST /discovery/admin/matching/generate-all
   * Backfill: enqueues feature generation for users with active discovery sessions.
   */
  @Post("generate-all")
  @HttpCode(HttpStatus.OK)
  async generateAll() {
    const { enqueued } = await this.discoveryService.enqueueFeatureGenerationForActiveSessions();
    return { enqueued, message: `Backfill enqueued for ${enqueued} active session users` };
  }
}
