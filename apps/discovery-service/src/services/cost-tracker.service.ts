/**
 * Cost tracker for embedding generation.
 * Uses Redis accumulators with INR currency.
 * Enforces hard monthly + daily budgets — callers must check canAfford() before paid API calls.
 */
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "./cache.service.js";
import {
  MATCHMAKING_DAILY_BUDGET_INR,
  MATCHMAKING_MONTHLY_BUDGET_INR
} from "../config/matching-admin.config.js";

interface CostSnapshot {
  total: number;
  daily: number;
  budget: number;
  dailyBudget: number;
  percent: number;
  remaining: number;
  dailyRemaining: number;
  overBudget: boolean;
}

@Injectable()
export class CostTrackerService implements OnModuleInit {
  private readonly logger = new Logger(CostTrackerService.name);
  private readonly TOTAL_KEY = "matchmaking:cost:total";
  private readonly DAILY_PREFIX = "matchmaking:cost:daily:";
  private readonly BUDGET_KEY = "matchmaking:cost:budget";
  private budget = MATCHMAKING_MONTHLY_BUDGET_INR;
  private dailyBudget = MATCHMAKING_DAILY_BUDGET_INR;

  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService
  ) {}

  async onModuleInit() {
    const monthlyRaw = this.config.get<string | number>("MATCHMAKING_MONTHLY_BUDGET_INR");
    const dailyRaw = this.config.get<string | number>("MATCHMAKING_DAILY_BUDGET_INR");
    const monthly = typeof monthlyRaw === "number" ? monthlyRaw : parseFloat(String(monthlyRaw ?? ""));
    const daily = typeof dailyRaw === "number" ? dailyRaw : parseFloat(String(dailyRaw ?? ""));
    this.budget = Number.isFinite(monthly) ? monthly : MATCHMAKING_MONTHLY_BUDGET_INR;
    this.dailyBudget = Number.isFinite(daily) ? daily : MATCHMAKING_DAILY_BUDGET_INR;
    const existing = await this.cache.get<number>(this.BUDGET_KEY);
    if (!existing) {
      await this.cache.set(this.BUDGET_KEY, this.budget, 86400 * 365);
    }
  }

  async record(inputTokens: number, model: string, costPer1kTokensInr: number): Promise<void> {
    const costInr = (inputTokens / 1000) * costPer1kTokensInr;

    const currentTotal = (await this.cache.get<number>(this.TOTAL_KEY)) || 0;
    await this.cache.set(this.TOTAL_KEY, currentTotal + costInr, 86400 * 365);

    const today = new Date().toISOString().split("T")[0];
    const dailyKey = `${this.DAILY_PREFIX}${today}`;
    const currentDaily = (await this.cache.get<number>(dailyKey)) || 0;
    await this.cache.set(dailyKey, currentDaily + costInr, 86400 * 2);

    this.logger.debug(
      `Recorded embedding cost: ${costInr.toFixed(4)} INR (${inputTokens} tokens, ${model})`
    );

    const snap = await this.getSnapshot();
    if (snap.overBudget) {
      this.logger.warn(
        `Matchmaking embedding budget exceeded: monthly ${snap.total.toFixed(2)}/${snap.budget}, daily ${snap.daily.toFixed(2)}/${snap.dailyBudget}`
      );
    }
  }

  /** Returns false when monthly or daily hard budget is exhausted. */
  async canAfford(estimatedCostInr: number = 0): Promise<boolean> {
    const snap = await this.getSnapshot();
    if (snap.remaining < estimatedCostInr) return false;
    if (snap.dailyRemaining < estimatedCostInr) return false;
    return true;
  }

  async getTotal(): Promise<number> {
    return (await this.cache.get<number>(this.TOTAL_KEY)) || 0;
  }

  async getDaily(date?: string): Promise<number> {
    const day = date || new Date().toISOString().split("T")[0];
    return (await this.cache.get<number>(`${this.DAILY_PREFIX}${day}`)) || 0;
  }

  async getDailyBreakdown(days: number = 30): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split("T")[0];
      result[key] = await this.getDaily(key);
    }
    return result;
  }

  async getSnapshot(): Promise<CostSnapshot> {
    const total = await this.getTotal();
    const daily = await this.getDaily();
    const remaining = Math.max(0, this.budget - total);
    const dailyRemaining = Math.max(0, this.dailyBudget - daily);
    return {
      total,
      daily,
      budget: this.budget,
      dailyBudget: this.dailyBudget,
      percent: this.budget > 0 ? (total / this.budget) * 100 : 100,
      remaining,
      dailyRemaining,
      overBudget: remaining <= 0 || dailyRemaining <= 0
    };
  }

  async setBudget(budget: number): Promise<void> {
    this.budget = budget;
    await this.cache.set(this.BUDGET_KEY, budget, 86400 * 365);
  }

  async getBudget(): Promise<number> {
    return this.budget;
  }

  async reset(): Promise<void> {
    await this.cache.set(this.TOTAL_KEY, 0, 86400 * 365);
  }
}
