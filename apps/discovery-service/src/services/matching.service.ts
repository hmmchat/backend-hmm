import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserClientService, DiscoveryUser } from "./user-client.service.js";
import { CacheService } from "./cache.service.js";
import {
  MATCH_SCORE_BRAND,
  MATCH_SCORE_INTEREST_EXACT,
  MATCH_SCORE_INTEREST_GENRE,
  MATCH_SCORE_VALUE,
  MATCH_SCORE_MUSIC,
  MATCH_SCORE_SAME_CITY,
  MATCH_SCORE_VIDEO,
  MATCH_SCORE_MODERATOR_PRIORITY
} from "../config/scoring.config.js";
import { DISCOVERY_POOL_LIMIT } from "../config/limits.config.js";
import fetch from "node-fetch";
import { isPreferredCityAnywhere } from "@hmm/common";

interface UserProfile {
  id: string;
  preferredCity: string | null;
  brandPreferences?: Array<{ brand: { id: string; name: string } }>;
  interests?: Array<{ interest: { id: string; name: string; genre: string | null } }>;
  values?: Array<{ value: { id: string; name: string } }>;
  musicPreference?: { id: string } | null;
  videoEnabled?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  actualCity?: string | null;
  isModerator?: boolean;
  kycStatus?: "UNVERIFIED" | "VERIFIED" | "PENDING_REVIEW" | "REVOKED" | "EXPIRED";
  kycRiskScore?: number;
  [key: string]: any;
}

interface MatchPair {
  user1: DiscoveryUser;
  user2: DiscoveryUser;
  score: number;
}

@Injectable()
export class MatchingService {
  private readonly userServiceUrl: string;
  private readonly userServiceStatusTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly userClient: UserClientService,
    private readonly cacheService: CacheService
  ) {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
    this.userServiceStatusTimeoutMs = parseInt(process.env.USER_SERVICE_STATUS_TIMEOUT_MS || "10000", 10);
  }

  private isKycPriorityEnabled(): boolean {
    return process.env.KYC_ENABLED === "true" && process.env.KYC_MODERATOR_PRIORITY_ENABLED === "true";
  }

  private shouldPrioritizeModeratorCandidate(
    requester: UserProfile,
    candidate: DiscoveryUser
  ): boolean {
    if (!this.isKycPriorityEnabled()) {
      return false;
    }
    if (requester.isModerator) {
      return false;
    }
    const requesterKycStatus = requester.kycStatus || "UNVERIFIED";
    if (requesterKycStatus === "VERIFIED") {
      return false;
    }
    return Boolean(candidate.isModerator);
  }

  /**
   * Calculate mutual compatibility score between two users
   * Returns the average of scores from both perspectives
   */
  calculateMutualScore(user1: UserProfile, user2: DiscoveryUser): number {
    const score1 = this.calculateMatchScore(user1, user2);
    
    // Convert user2 to UserProfile format for reverse calculation
    const user2Profile: UserProfile = {
      id: user2.id,
      preferredCity: user2.preferredCity,
      brandPreferences: user2.brandPreferences,
      interests: user2.interests,
      values: user2.values,
      musicPreference: user2.musicPreference,
      videoEnabled: user2.videoEnabled,
      actualCity: null
    };
    
    // Convert user1 to DiscoveryUser format for reverse calculation
    const user1Discovery: DiscoveryUser = {
      id: user1.id,
      username: null,
      dateOfBirth: null,
      gender: null,
      displayPictureUrl: null,
      preferredCity: user1.preferredCity,
      intent: null,
      status: "",
      photos: [],
      musicPreference: user1.musicPreference ? {
        id: (user1.musicPreference as any).id || "",
        name: (user1.musicPreference as any).name || "",
        artist: (user1.musicPreference as any).artist || "",
        albumArtUrl: (user1.musicPreference as any).albumArtUrl || null
      } : null,
      brandPreferences: (user1.brandPreferences || []).map((bp: any) => ({
        brand: {
          id: bp.brand.id,
          name: bp.brand.name,
          logoUrl: bp.brand.logoUrl || null
        }
      })),
      interests: (user1.interests || []).map((i: any) => ({
        interest: {
          id: i.interest.id,
          name: i.interest.name,
          genre: i.interest.genre || null
        }
      })),
      values: (user1.values || []).map((v: any) => ({
        value: {
          id: v.value.id,
          name: v.value.name
        }
      })),
      videoEnabled: user1.videoEnabled || false
    };
    
    const score2 = this.calculateMatchScore(user2Profile, user1Discovery);
    
    // Return average of both scores
    return (score1 + score2) / 2;
  }

  /**
   * Calculate match score from one user's perspective
   * (Reused from discovery.service.ts logic)
   */
  private calculateMatchScore(user: UserProfile, targetUser: DiscoveryUser): number {
    let score = 0;

    // Brands (equal weight)
    const userBrandIds = new Set(
      (user.brandPreferences || []).map((bp) => bp.brand.id)
    );
    const targetBrandIds = new Set(
      targetUser.brandPreferences.map((bp) => bp.brand.id)
    );
    const commonBrands = [...userBrandIds].filter((id) => targetBrandIds.has(id));
    score += commonBrands.length * MATCH_SCORE_BRAND;

    // Interests: sub-genre match = MATCH_SCORE_INTEREST_EXACT, genre match = MATCH_SCORE_INTEREST_GENRE
    const userInterests = (user.interests || []).map((i) => ({
      id: i.interest.id,
      name: i.interest.name,
      genre: i.interest.genre
    }));
    const targetInterests = targetUser.interests.map((i) => ({
      id: i.interest.id,
      name: i.interest.name,
      genre: i.interest.genre
    }));

    // Track which interests have been matched to avoid double counting
    const matchedUserInterestIds = new Set<string>();
    const matchedTargetInterestIds = new Set<string>();

    // First pass: Check for exact sub-genre matches (15 points each)
    for (const userInterest of userInterests) {
      for (const targetInterest of targetInterests) {
        if (userInterest.id === targetInterest.id) {
          // Exact match (same sub-genre)
          if (!matchedUserInterestIds.has(userInterest.id) && !matchedTargetInterestIds.has(targetInterest.id)) {
            score += MATCH_SCORE_INTEREST_EXACT;
            matchedUserInterestIds.add(userInterest.id);
            matchedTargetInterestIds.add(targetInterest.id);
          }
        }
      }
    }

    // Second pass: Check for genre matches (different sub-genres, same genre) = 10 points each
    for (const userInterest of userInterests) {
      if (matchedUserInterestIds.has(userInterest.id)) continue; // Already matched
      
      for (const targetInterest of targetInterests) {
        if (matchedTargetInterestIds.has(targetInterest.id)) continue; // Already matched
        
        // Same genre but different sub-genre
        if (userInterest.genre && targetInterest.genre && 
            userInterest.genre === targetInterest.genre && 
            userInterest.id !== targetInterest.id) {
          score += MATCH_SCORE_INTEREST_GENRE;
          matchedUserInterestIds.add(userInterest.id);
          matchedTargetInterestIds.add(targetInterest.id);
          break; // Only match once per user interest
        }
      }
    }

    // Values: 20 points per match
    const userValueIds = new Set(
      (user.values || []).map((v) => v.value.id)
    );
    const targetValueIds = new Set(
      targetUser.values.map((v) => v.value.id)
    );
    const commonValues = [...userValueIds].filter((id) => targetValueIds.has(id));
    score += commonValues.length * MATCH_SCORE_VALUE;

    // Music preference
    if (
      user.musicPreference?.id &&
      targetUser.musicPreference?.id &&
      user.musicPreference.id === targetUser.musicPreference.id
    ) {
      score += MATCH_SCORE_MUSIC;
    }

    // Same city (only when viewer is in "anywhere" stored preference mode)
    if (isPreferredCityAnywhere(user.preferredCity) && user.actualCity && targetUser.preferredCity) {
      if (user.actualCity.toLowerCase() === targetUser.preferredCity.toLowerCase()) {
        score += MATCH_SCORE_SAME_CITY;
      }
    }

    // Video preference (if both have same preference)
    if (
      user.videoEnabled !== undefined &&
      targetUser.videoEnabled !== undefined &&
      user.videoEnabled === targetUser.videoEnabled
    ) {
      score += MATCH_SCORE_VIDEO;
    }

    if (this.shouldPrioritizeModeratorCandidate(user, targetUser)) {
      score += MATCH_SCORE_MODERATOR_PRIORITY;
    }

    return score;
  }

  /**
   * Get all users in the matchmaking pool
   */
  async getPoolUsers(
    city: string | null,
    genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[],
    excludeUserIds: string[] = [],
    matchedUserIds?: Set<string>, // Accept as parameter to avoid N+1 query
    requestingUser?: UserProfile
  ): Promise<DiscoveryUser[]> {
    const statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[] = [
      "AVAILABLE",
      "IN_SQUAD_AVAILABLE",
      "IN_BROADCAST_AVAILABLE"
    ];

    const requesterIsModerator = Boolean(requestingUser?.isModerator);
    const requesterKycStatus = requestingUser?.kycStatus || "UNVERIFIED";
    const requesterModeratorCardsOnly = Boolean((requestingUser as any)?.reportModeratorCardsOnly);
    const priorityEnabled = this.isKycPriorityEnabled();

    const allUsers = await this.userClient.getUsersForDiscoveryById("", {
      city,
      statuses,
      genders,
      excludeUserIds,
      ...(requesterModeratorCardsOnly
        ? { onlyModerators: true as const }
        : {
            excludeModerators: requesterIsModerator || (priorityEnabled && requesterKycStatus === "VERIFIED"),
            excludeKycStatuses: requesterIsModerator ? ["VERIFIED"] : []
          }),
      limit: DISCOVERY_POOL_LIMIT
    });

    console.log(`[DEBUG] getPoolUsers - allUsers from user-service: ${allUsers.length}`);
    if (allUsers.length > 0) {
      console.log(`[DEBUG] getPoolUsers - Sample user statuses:`, allUsers.slice(0, 5).map(u => `${u.id}:${u.status}`).join(', '));
    }

    // Filter out users who are already matched
    // IMPORTANT: Only exclude users who are BOTH in matchedUserIds AND have MATCHED status
    // Users with AVAILABLE status should be available for matching even if they have an old match record
    const matched = matchedUserIds || await this.getMatchedUserIdsCached();
    console.log(`[DEBUG] getPoolUsers - matchedUserIds count: ${matched.size}`);
    
    const filteredUsers = allUsers.filter(user => {
      // Exclude if user is in exclude list
      if (excludeUserIds.includes(user.id)) {
        return false;
      }

      if (requesterModeratorCardsOnly) {
        return Boolean(user.isModerator);
      }

      if (requesterIsModerator) {
        if (user.isModerator) {
          return false;
        }
        if (user.kycStatus === "VERIFIED") {
          return false;
        }
      } else if (priorityEnabled && requesterKycStatus === "VERIFIED" && user.isModerator) {
        return false;
      }
      
      // Only exclude if user is in matchedUserIds AND has MATCHED status
      // If user is AVAILABLE (or IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE), they should be available for matching
      if (matched.has(user.id)) {
        // User has a match record - only exclude if they're actually MATCHED
        // If status is AVAILABLE, they should be available for matching (old match record should be cleaned up)
        const shouldExclude = user.status === 'MATCHED';
        if (shouldExclude) {
          console.log(`[DEBUG] getPoolUsers - Excluding ${user.id} (status: ${user.status}, in matched set)`);
        } else {
          console.log(`[DEBUG] getPoolUsers - Including ${user.id} (status: ${user.status}, in matched set but not MATCHED - old match record)`);
        }
        return shouldExclude;
      }
      
      // User is not in matched list, so they're available
      return true;
    });
    
    console.log(`[DEBUG] getPoolUsers - filteredUsers count: ${filteredUsers.length}`);
    return filteredUsers;
  }

  /**
   * Get set of user IDs that are currently matched
   */
  async getMatchedUserIds(): Promise<Set<string>> {
    try {
      let matches: Array<{ user1Id: string; user2Id: string }> = [];
      
      if ((this.prisma as any).activeMatch) {
        // Use Prisma client - get all matches (no expiration check)
        matches = await (this.prisma as any).activeMatch.findMany({
          select: {
            user1Id: true,
            user2Id: true
          }
        });
      } else {
        // Fallback to raw SQL - get all matches (no expiration check)
        matches = await (this.prisma as any).$queryRawUnsafe(
          `SELECT "user1Id", "user2Id" FROM active_matches`
        );
      }

      const matchedIds = new Set<string>();
      for (const match of matches) {
        matchedIds.add(match.user1Id);
        matchedIds.add(match.user2Id);
      }
      return matchedIds;
    } catch (error: any) {
      // If table doesn't exist yet, return empty set
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        return new Set<string>();
      }
        // Try raw SQL fallback - get all matches (no expiration check)
        try {
          const matches = await (this.prisma as any).$queryRawUnsafe(
            `SELECT "user1Id", "user2Id" FROM active_matches`
          );
        const matchedIds = new Set<string>();
        for (const match of matches) {
          matchedIds.add(match.user1Id);
          matchedIds.add(match.user2Id);
        }
        return matchedIds;
      } catch (sqlError: any) {
        console.warn(`Failed to get matched user IDs via SQL fallback:`, sqlError?.message || sqlError);
        return new Set<string>();
      }
    }
  }

  /**
   * Get set of user IDs that are currently matched (with caching)
   */
  async getMatchedUserIdsCached(): Promise<Set<string>> {
    const cacheKey = "matched:user:ids";
    const ttl = 2; // 2 seconds cache (very short due to high change rate)
    
    // Try cache first
    const cached = await this.cacheService.get<string[]>(cacheKey);
    if (cached) {
      return new Set(cached);
    }
    
    // Fetch from database
    const matchedIds = await this.getMatchedUserIds();
    const idsArray = Array.from(matchedIds);
    
    // Cache for 2 seconds
    await this.cacheService.set(cacheKey, idsArray, ttl);
    return matchedIds;
  }

  /**
   * Find match for a specific user
   * Returns the matched user or null if no match found
   */
  async findMatchForUser(
    userId: string,
    userProfile: UserProfile,
    city: string | null,
    genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[],
    excludeUserIds: string[] = []
  ): Promise<DiscoveryUser | null> {
    // Check if user is already matched
    const existingMatch = await this.getMatchForUser(userId);
    if (existingMatch) {
      const matchedUserId = existingMatch.user1Id === userId ? existingMatch.user2Id : existingMatch.user1Id;
      const matchedUser = await this.userClient.getUserFullProfileById(matchedUserId);
      return this.convertToDiscoveryUser(matchedUser);
    }

    // Get matched user IDs once (cached) to use in both getPoolUsers and match selection
    const matchedUserIds = await this.getMatchedUserIdsCached();

    // Get pool users (pass matchedUserIds to avoid N+1 query)
    console.log(`[DEBUG] findMatchForUser for ${userId} - excludeUserIds:`, excludeUserIds);
    const poolUsers = await this.getPoolUsers(city, genders, [...excludeUserIds, userId], matchedUserIds, userProfile);
    console.log(`[DEBUG] findMatchForUser for ${userId} - poolUsers count:`, poolUsers.length);

    if (poolUsers.length === 0) {
      console.log(`[DEBUG] findMatchForUser for ${userId} - no pool users available`);
      return null;
    }

    // Calculate scores for all potential matches (parallelized)
    const scorePromises = poolUsers.map(candidate =>
      Promise.resolve({
        user: candidate,
        score: this.calculateMutualScore(userProfile, candidate)
      })
    );
    const scoredPairs = await Promise.all(scorePromises);
    console.log(`[DEBUG] findMatchForUser for ${userId} - calculated ${scoredPairs.length} scored pairs`);

    // Sort by score (descending)
    scoredPairs.sort((a, b) => b.score - a.score);

    // Find best available match.
    // Use atomic createMatch() to enforce one-active-match-per-user at write time,
    // instead of relying on stale cached matched-user snapshots.
    for (const pair of scoredPairs) {
      // Create match (no expiration - persists until raincheck)
      const result = await this.createMatch(userId, pair.user.id, pair.score);
      if (!result.success) {
        // Candidate was already matched elsewhere or insert failed; try next best candidate.
        if (result.reason !== "already_matched_elsewhere") {
          console.error(`[ERROR] Failed to create match in findMatchForUser for ${userId} and ${pair.user.id}:`, result.error || result.reason);
        }
        continue;
      }
      // Update both users' status to MATCHED (parallelized for performance)
      await Promise.all([
        this.updateUserStatus(userId, "MATCHED"),
        this.updateUserStatus(pair.user.id, "MATCHED")
      ]);
      return pair.user;
    }

    return null;
  }

  /**
   * Perform greedy matching for all users in pool
   * Matches highest-scoring pairs first
   */
  async matchAllUsers(
    city: string | null,
    genders?: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[]
  ): Promise<MatchPair[]> {
    // Get all users in pool
    const poolUsers = await this.getPoolUsers(city, genders, []);
    
    if (poolUsers.length < 2) {
      return [];
    }

    // Get full profiles for all users (needed for score calculation)
    const userProfiles: Map<string, UserProfile> = new Map();
    for (const user of poolUsers) {
      try {
        const fullProfile = await this.userClient.getUserFullProfileById(user.id);
        userProfiles.set(user.id, {
          id: fullProfile.id,
          preferredCity: fullProfile.preferredCity,
          brandPreferences: fullProfile.brandPreferences,
          interests: fullProfile.interests,
          values: fullProfile.values,
          musicPreference: fullProfile.musicPreference,
          videoEnabled: fullProfile.videoEnabled,
          actualCity: null
        });
      } catch (error) {
        console.error(`Failed to get full profile for user ${user.id}:`, error);
        continue;
      }
    }

    // Calculate mutual scores for all pairs
    const pairs: MatchPair[] = [];
    const processedPairs = new Set<string>();

    for (let i = 0; i < poolUsers.length; i++) {
      for (let j = i + 1; j < poolUsers.length; j++) {
        const user1 = poolUsers[i];
        const user2 = poolUsers[j];
        
        // Create unique pair key (sorted IDs)
        const pairKey = [user1.id, user2.id].sort().join("-");
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const profile1 = userProfiles.get(user1.id);
        const profile2 = userProfiles.get(user2.id);
        
        if (!profile1 || !profile2) continue;

        const score = this.calculateMutualScore(profile1, user2);
        pairs.push({ user1, user2, score });
      }
    }

    // Sort pairs by score (descending)
    pairs.sort((a, b) => b.score - a.score);

    // Greedily match highest-scoring pairs
    const matchedUserIds = new Set<string>();
    const matches: MatchPair[] = [];

    for (const pair of pairs) {
      if (!matchedUserIds.has(pair.user1.id) && !matchedUserIds.has(pair.user2.id)) {
        // Create match
        const result = await this.createMatch(pair.user1.id, pair.user2.id, pair.score);
        if (!result.success) {
          console.error(`[ERROR] Failed to create match in findMutualMatches for ${pair.user1.id} and ${pair.user2.id}:`, result.error);
          // Continue to next pair instead of failing completely
          continue;
        }
        // Update both users' status to MATCHED (parallelized for performance)
        await Promise.all([
          this.updateUserStatus(pair.user1.id, "MATCHED"),
          this.updateUserStatus(pair.user2.id, "MATCHED")
        ]);
        
        matchedUserIds.add(pair.user1.id);
        matchedUserIds.add(pair.user2.id);
        matches.push(pair);
      }
    }

    return matches;
  }

  /**
   * Get match for a specific user
   */
  async getMatchForUser(userId: string): Promise<{ user1Id: string; user2Id: string; score: number } | null> {
    try {
      if ((this.prisma as any).activeMatch) {
        // Use Prisma client - get match (no expiration check)
        const match = await (this.prisma as any).activeMatch.findFirst({
          where: {
            OR: [
              { user1Id: userId },
              { user2Id: userId }
            ]
          },
          orderBy: { createdAt: "desc" }
        });
        return match;
      } else {
        // Fallback to raw SQL - get match (no expiration check)
        // Use string interpolation for userId since it's already validated
        const escapedUserId = userId.replace(/'/g, "''");
        const matches = await (this.prisma as any).$queryRawUnsafe(
          `SELECT "user1Id", "user2Id", score FROM active_matches 
           WHERE "user1Id" = '${escapedUserId}' OR "user2Id" = '${escapedUserId}'
           ORDER BY "createdAt" DESC
           LIMIT 1`
        );
        return matches && matches.length > 0 ? matches[0] : null;
      }
    } catch (error: any) {
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        return null;
      }
      // Try raw SQL fallback - get match (no expiration check)
      try {
        const escapedUserId = userId.replace(/'/g, "''");
        const matches = await (this.prisma as any).$queryRawUnsafe(
          `SELECT "user1Id", "user2Id", score FROM active_matches 
           WHERE "user1Id" = '${escapedUserId}' OR "user2Id" = '${escapedUserId}'
           ORDER BY "createdAt" DESC
           LIMIT 1`
        );
        return matches && matches.length > 0 ? matches[0] : null;
      } catch (sqlError: any) {
        console.warn(`Failed to get match via SQL fallback:`, sqlError?.message || sqlError);
        return null;
      }
    }
  }

  /**
   * Create a match between two users
   * Matches do NOT expire - they persist until someone rainchecks
   * Returns success status and error details if failed
   */
  async createMatch(
    user1Id: string,
    user2Id: string,
    score: number
  ): Promise<{ success: boolean; created: boolean; reason?: string; error?: any }> {
    try {
      // Ensure user1Id < user2Id for consistency
      const [id1, id2] = [user1Id, user2Id].sort();

      const escapedId1 = id1.replace(/'/g, "''");
      const escapedId2 = id2.replace(/'/g, "''");

      const txResult = await (this.prisma as any).$transaction(async (tx: any) => {
        // Serialize all writes for these two users to prevent concurrent multi-match creation.
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${escapedId1}'))`);
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${escapedId2}'))`);

        // If either user is already part of any active match, do not create a new match.
        const existing = await tx.$queryRawUnsafe(
          `SELECT "user1Id", "user2Id"
           FROM active_matches
           WHERE "user1Id" IN ('${escapedId1}', '${escapedId2}')
              OR "user2Id" IN ('${escapedId1}', '${escapedId2}')
           ORDER BY "createdAt" DESC
           LIMIT 1`
        );

        if (existing && existing.length > 0) {
          const row = existing[0];
          const samePair =
            (row.user1Id === id1 && row.user2Id === id2) ||
            (row.user1Id === id2 && row.user2Id === id1);
          return {
            success: samePair,
            created: false,
            reason: samePair ? "already_exists" : "already_matched_elsewhere"
          };
        }

        // Insert with backward compatibility for optional expiresAt column.
        let rowsAffected = 0;
        try {
          rowsAffected = await tx.$executeRawUnsafe(
            `INSERT INTO active_matches (id, "user1Id", "user2Id", score, "expiresAt", "createdAt", "updatedAt")
             VALUES (gen_random_uuid()::text, '${escapedId1}', '${escapedId2}', ${score}, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT ("user1Id", "user2Id") DO NOTHING`
          );
        } catch (expiresAtError: any) {
          if (expiresAtError?.message?.includes('expiresAt') || expiresAtError?.code === '42703') {
            rowsAffected = await tx.$executeRawUnsafe(
              `INSERT INTO active_matches (id, "user1Id", "user2Id", score, "createdAt", "updatedAt")
               VALUES (gen_random_uuid()::text, '${escapedId1}', '${escapedId2}', ${score}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT ("user1Id", "user2Id") DO NOTHING`
            );
          } else {
            throw expiresAtError;
          }
        }

        if ((rowsAffected || 0) > 0) {
          return { success: true, created: true };
        }

        // Fallback: treat as existing pair if conflict happened concurrently.
        return { success: true, created: false, reason: "already_exists" };
      });

      await this.cacheService.del("matched:user:ids");
      if (txResult.created) {
        console.log(`[DEBUG] Created match between ${id1} and ${id2} (atomic)`);
      } else {
        console.log(`[DEBUG] Match not created between ${id1} and ${id2}: ${txResult.reason || 'already_exists'}`);
      }
      return txResult;
    } catch (unsafeError: any) {
      const errorDetails = {
        code: unsafeError?.code,
        message: unsafeError?.message,
        detail: unsafeError?.detail,
        hint: unsafeError?.hint,
        stack: unsafeError?.stack
      };
      console.error(`[ERROR] Failed to create match between ${user1Id} and ${user2Id}:`, errorDetails);
      console.error(`[ERROR] Full error object:`, JSON.stringify(errorDetails, null, 2));
      return { success: false, created: false, error: errorDetails };
    }
  }

  /**
   * Remove match between two users
   */
  async removeMatch(user1Id: string, user2Id: string): Promise<void> {
    console.log(`[DEBUG] removeMatch called for users ${user1Id} and ${user2Id}`);
    try {
      const [id1, id2] = [user1Id, user2Id].sort();
      console.log(`[DEBUG] Sorted IDs: ${id1}, ${id2}`);
      
      // Always use raw SQL (consistent with createMatch) since Prisma client might not have activeMatch model
      const escapedId1 = id1.replace(/'/g, "''");
      const escapedId2 = id2.replace(/'/g, "''");
      
      console.log(`[DEBUG] Executing DELETE query for match between ${id1} and ${id2}`);
      const result = await (this.prisma as any).$executeRawUnsafe(
        `DELETE FROM active_matches WHERE "user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}'`
      );
      console.log(`[DEBUG] DELETE query result:`, result);
      
      // Verify the match was removed
      const verify = await (this.prisma as any).$queryRawUnsafe(
        `SELECT COUNT(*) as count FROM active_matches WHERE "user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}'`
      );
      console.log(`[DEBUG] Match verification after delete:`, verify?.[0]?.count || 'null');
      
      // Invalidate matched user IDs cache
      await this.cacheService.del("matched:user:ids");
    } catch (error: any) {
      console.error(`[ERROR] Failed to remove match between ${user1Id} and ${user2Id}:`, error?.message || error);
      throw error; // Re-throw so caller knows it failed
    }
  }

  /**
   * Update user status in user-service (authoritative `users` table).
   * Discovery DB does not contain `users`; never use discovery Prisma for profile status unless
   * DISCOVERY_STATUS_USE_DIRECT_DB=true (single shared DB / local monolith only).
   */
  async updateUserStatus(userId: string, status: string): Promise<void> {
    console.log(`[DEBUG] updateUserStatus called for user ${userId} to status ${status}`);
    const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
    const internalUrl = `${this.userServiceUrl}/users/internal/${userId}/status`;
    const testUrl = `${this.userServiceUrl}/users/test/${userId}/status`;

    try {
      const jsonHeaders: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (serviceToken) {
        jsonHeaders["x-service-token"] = serviceToken;
      }

      let response = await fetch(serviceToken ? internalUrl : testUrl, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status }),
        signal: AbortSignal.timeout(this.userServiceStatusTimeoutMs)
      } as any);

      // Gradual rollout: older user-service images may not expose /users/internal/.../status yet.
      if (!response.ok && serviceToken && response.status === 404) {
        response = await fetch(testUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
          signal: AbortSignal.timeout(this.userServiceStatusTimeoutMs)
        } as any);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`user-service ${response.status}: ${errorText}`);
      }
      console.log(`[DEBUG] Status updated via user-service for ${userId} -> ${status}`);
    } catch (httpError: any) {
      if (process.env.DISCOVERY_STATUS_USE_DIRECT_DB === "true") {
        console.warn(
          `[WARN] user-service PATCH failed for ${userId}, trying direct DB (DISCOVERY_STATUS_USE_DIRECT_DB):`,
          httpError?.message || httpError
        );
        await this.updateUserStatusDirect(userId, status);
        return;
      }
      console.error(`[ERROR] updateUserStatus failed for ${userId}:`, httpError?.message || httpError);
      throw httpError;
    }
  }

  /**
   * Direct SQL update — only valid when discovery shares the same Postgres as user-service.
   */
  private async updateUserStatusDirect(userId: string, status: string): Promise<void> {
    try {
      // Use string interpolation with proper escaping (Prisma $executeRawUnsafe doesn't support $1, $2 syntax)
      const escapedStatus = status.replace(/'/g, "''");
      const escapedUserId = userId.replace(/'/g, "''");
      
      console.log(`[DEBUG] Attempting to update status for user ${userId} to ${status}`);
      const result = await (this.prisma as any).$executeRawUnsafe(
        `UPDATE users SET status = '${escapedStatus}'::"UserStatus" WHERE id = '${escapedUserId}'`
      );
      console.log(`[DEBUG] Status update query result for user ${userId}:`, result);
      
      // Verify the update worked
      const verify = await (this.prisma as any).$queryRawUnsafe(
        `SELECT status FROM users WHERE id = '${escapedUserId}'`
      );
      console.log(`[DEBUG] Status verification for user ${userId}:`, verify?.[0]?.status || 'null');
      
      if (!verify || verify.length === 0 || verify[0].status !== status) {
        console.warn(`[DEBUG] Status update verification failed for user ${userId}: expected ${status}, got ${verify?.[0]?.status || 'null'}`);
      } else {
        console.log(`[DEBUG] Status update successful for user ${userId}: ${status}`);
      }
    } catch (error: any) {
      console.error(`[ERROR] Could not update status directly for user ${userId} to ${status}:`, error?.message || error);
      throw error; // Re-throw so caller knows it failed
    }
  }

  /**
   * Convert UserProfileResponse to DiscoveryUser format
   */
  private convertToDiscoveryUser(profile: any): DiscoveryUser {
    return {
      id: profile.id,
      username: profile.username || null,
      dateOfBirth: profile.dateOfBirth || null,
      gender: profile.gender || null,
      displayPictureUrl: profile.displayPictureUrl || null,
      preferredCity: profile.preferredCity || null,
      intent: profile.intent || null,
      status: profile.status || "AVAILABLE",
      photos: (profile.photos || []).map((p: any) => ({
        id: p.id,
        url: p.url,
        order: p.order
      })),
      musicPreference: profile.musicPreference ? {
        id: profile.musicPreference.id,
        name: profile.musicPreference.name,
        artist: profile.musicPreference.artist,
        albumArtUrl: profile.musicPreference.albumArtUrl || null
      } : null,
      brandPreferences: (profile.brandPreferences || []).map((bp: any) => ({
        brand: {
          id: bp.brand.id,
          name: bp.brand.name,
          logoUrl: bp.brand.logoUrl || null
        }
      })),
      interests: (profile.interests || []).map((i: any) => ({
        interest: {
          id: i.interest.id,
          name: i.interest.name,
          genre: i.interest.genre || null
        }
      })),
      values: (profile.values || []).map((v: any) => ({
        value: {
          id: v.value.id,
          name: v.value.name
        }
      })),
      videoEnabled: profile.videoEnabled !== undefined ? profile.videoEnabled : true,
      reportCount: profile.reportCount || 0,
      isModerator: Boolean(profile.isModerator),
      kycStatus: profile.kycStatus || "UNVERIFIED",
      kycRiskScore: profile.kycRiskScore || 0,
      kycExpiresAt: profile.kycExpiresAt || null
    };
  }

  /**
   * Record match acceptance for a user
   */
  async recordMatchAcceptance(user1Id: string, user2Id: string, acceptedBy: string, timeoutSeconds: number): Promise<void> {
    try {
      const [id1, id2] = [user1Id, user2Id].sort();
      const escapedId1 = id1.replace(/'/g, "''");
      const escapedId2 = id2.replace(/'/g, "''");
      const escapedAcceptedBy = acceptedBy.replace(/'/g, "''");
      
      await (this.prisma as any).$executeRawUnsafe(
        `INSERT INTO match_acceptances (id, "user1Id", "user2Id", "acceptedBy", "createdAt", "expiresAt")
         VALUES (gen_random_uuid()::text, '${escapedId1}', '${escapedId2}', '${escapedAcceptedBy}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '${timeoutSeconds} seconds')
         ON CONFLICT ("user1Id", "user2Id", "acceptedBy") DO NOTHING`
      );
      console.log(`[DEBUG] Recorded match acceptance: ${id1} <-> ${id2}, acceptedBy: ${acceptedBy}, expires in ${timeoutSeconds}s`);
    } catch (error: any) {
      console.error(`[ERROR] Failed to record match acceptance for ${acceptedBy}:`, error?.message || error);
      throw error;
    }
  }

  /**
   * Check if both users have accepted the match
   */
  async checkBothAccepted(user1Id: string, user2Id: string): Promise<boolean> {
    try {
      const [id1, id2] = [user1Id, user2Id].sort();
      const escapedId1 = id1.replace(/'/g, "''");
      const escapedId2 = id2.replace(/'/g, "''");
      
      const acceptances = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "acceptedBy" FROM match_acceptances 
         WHERE "user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}' 
         AND "expiresAt" > CURRENT_TIMESTAMP`
      );
      
      if (!acceptances || acceptances.length < 2) {
        return false;
      }
      
      const acceptedBySet = new Set(acceptances.map((a: any) => a.acceptedBy));
      return acceptedBySet.has(id1) && acceptedBySet.has(id2);
    } catch (error: any) {
      console.error(`[ERROR] Failed to check match acceptances:`, error?.message || error);
      return false;
    }
  }

  /**
   * Get acceptance state for a match pair.
   * Returns who has accepted within the active acceptance timeout window.
   */
  async getAcceptanceState(
    user1Id: string,
    user2Id: string
  ): Promise<{ acceptedBy: Set<string>; bothAccepted: boolean }> {
    try {
      const [id1, id2] = [user1Id, user2Id].sort();
      const escapedId1 = id1.replace(/'/g, "''");
      const escapedId2 = id2.replace(/'/g, "''");

      const acceptances = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "acceptedBy" FROM match_acceptances
         WHERE "user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}'
         AND "expiresAt" > CURRENT_TIMESTAMP`
      );

      const acceptedByValues: string[] = (acceptances || []).map((a: any) => String(a.acceptedBy));
      const acceptedBy = new Set<string>(acceptedByValues);
      const bothAccepted = acceptedBy.has(id1) && acceptedBy.has(id2);
      return { acceptedBy, bothAccepted };
    } catch (error: any) {
      console.error(`[ERROR] Failed to get acceptance state:`, error?.message || error);
      return { acceptedBy: new Set<string>(), bothAccepted: false };
    }
  }

  /**
   * Remove match acceptances for a match
   */
  async removeMatchAcceptances(user1Id: string, user2Id: string): Promise<void> {
    try {
      const [id1, id2] = [user1Id, user2Id].sort();
      const escapedId1 = id1.replace(/'/g, "''");
      const escapedId2 = id2.replace(/'/g, "''");
      
      await (this.prisma as any).$executeRawUnsafe(
        `DELETE FROM match_acceptances WHERE "user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}'`
      );
    } catch (error: any) {
      console.error(`[ERROR] Failed to remove match acceptances:`, error?.message || error);
      // Don't throw - cleanup operation
    }
  }

  /**
   * Clean up expired match acceptances (only - matches themselves don't expire)
   * Should be called periodically (e.g., via cron job or interval)
   * Note: Active matches do NOT expire - they persist until someone rainchecks
   */
  async cleanupExpiredMatches(): Promise<void> {
    try {
      // Only clean up expired acceptances (matches themselves don't expire)
      // When one user accepts, we wait 5 seconds for the other to accept
      // If timeout expires, both users go back to AVAILABLE
      const expiredAcceptances = await (this.prisma as any).$queryRawUnsafe(
        `SELECT DISTINCT "user1Id", "user2Id" 
         FROM match_acceptances 
         WHERE "expiresAt" <= CURRENT_TIMESTAMP
         AND NOT EXISTS (
           SELECT 1 FROM match_acceptances ma2
           WHERE ma2."user1Id" = match_acceptances."user1Id"
           AND ma2."user2Id" = match_acceptances."user2Id"
           AND ma2."expiresAt" > CURRENT_TIMESTAMP
           GROUP BY ma2."user1Id", ma2."user2Id"
           HAVING COUNT(DISTINCT ma2."acceptedBy") = 2
         )`
      );
      
      for (const match of expiredAcceptances || []) {
        const user1Id = match.user1Id;
        const user2Id = match.user2Id;
        
        // Remove the match (acceptance timeout expired - both go back to AVAILABLE)
        await this.removeMatch(user1Id, user2Id);
        
        // Remove acceptances
        await this.removeMatchAcceptances(user1Id, user2Id);
        
        // Revert both users to AVAILABLE (they can see new cards now)
        await this.updateUserStatus(user1Id, "AVAILABLE");
        await this.updateUserStatus(user2Id, "AVAILABLE");
        
        console.log(`[INFO] Cleaned up expired match acceptance between ${user1Id} and ${user2Id} (acceptance timeout expired - both reset to AVAILABLE)`);
      }
    } catch (error: any) {
      console.error(`[ERROR] Failed to cleanup expired matches:`, error?.message || error);
    }
  }

  /**
   * Reconcile legacy/conflicting active_matches rows where a user appears in multiple matches.
   * Keeps the latest row per canonical pair and per user side, deletes older conflicting rows.
   */
  async reconcileActiveMatchConflicts(): Promise<{ removed: number }> {
    try {
      const deletedRows = await (this.prisma as any).$queryRawUnsafe(
        `WITH ranked AS (
           SELECT
             id,
             ROW_NUMBER() OVER (
               PARTITION BY LEAST("user1Id","user2Id"), GREATEST("user1Id","user2Id")
               ORDER BY "createdAt" DESC, id DESC
             ) AS rn_pair,
             ROW_NUMBER() OVER (PARTITION BY "user1Id" ORDER BY "createdAt" DESC, id DESC) AS rn_u1,
             ROW_NUMBER() OVER (PARTITION BY "user2Id" ORDER BY "createdAt" DESC, id DESC) AS rn_u2
           FROM active_matches
         ),
         to_delete AS (
           SELECT id
           FROM ranked
           WHERE rn_pair > 1 OR rn_u1 > 1 OR rn_u2 > 1
         )
         DELETE FROM active_matches
         WHERE id IN (SELECT id FROM to_delete)
         RETURNING id`
      );

      const removed = Array.isArray(deletedRows) ? deletedRows.length : 0;
      if (removed > 0) {
        await this.cacheService.del("matched:user:ids");
        console.warn(`[WARN] Reconciled active_matches conflicts: removed ${removed} stale/conflicting row(s)`);
      }
      return { removed };
    } catch (error: any) {
      console.error(`[ERROR] Failed to reconcile active_matches conflicts:`, error?.message || error);
      return { removed: 0 };
    }
  }
}

