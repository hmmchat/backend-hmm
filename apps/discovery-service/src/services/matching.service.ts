import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserClientService, DiscoveryUser } from "./user-client.service.js";
import { CacheService } from "./cache.service.js";
import fetch from "node-fetch";

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly userClient: UserClientService,
    private readonly cacheService: CacheService
  ) {
    this.userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:3002";
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
    score += commonBrands.length * 10;

    // Interests: sub-genre match = 15pts, genre match (different sub-genre) = 10pts
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
            score += 15;
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
          score += 10;
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
    score += commonValues.length * 20;

    // Music preference: 30 points
    if (
      user.musicPreference?.id &&
      targetUser.musicPreference?.id &&
      user.musicPreference.id === targetUser.musicPreference.id
    ) {
      score += 30;
    }

    // Same city: 50 points (only when viewer's preferredCity is null - "anywhere" mode)
    if (user.preferredCity === null && user.actualCity && targetUser.preferredCity) {
      if (user.actualCity.toLowerCase() === targetUser.preferredCity.toLowerCase()) {
        score += 50;
      }
    }

    // Video preference: 100 points (if both have same preference)
    if (
      user.videoEnabled !== undefined &&
      targetUser.videoEnabled !== undefined &&
      user.videoEnabled === targetUser.videoEnabled
    ) {
      score += 100;
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
    matchedUserIds?: Set<string> // Accept as parameter to avoid N+1 query
  ): Promise<DiscoveryUser[]> {
    const statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[] = [
      "AVAILABLE",
      "IN_SQUAD_AVAILABLE",
      "IN_BROADCAST_AVAILABLE"
    ];

    // Get all users in pool
    const allUsers = await this.userClient.getUsersForDiscoveryById("", {
      city,
      statuses,
      genders,
      excludeUserIds,
      limit: 500 // Get large pool (max allowed by user-service)
    });

    // Filter out users who are already matched (use cached if not provided)
    const matched = matchedUserIds || await this.getMatchedUserIdsCached();
    return allUsers.filter(user => !matched.has(user.id));
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
    const poolUsers = await this.getPoolUsers(city, genders, [...excludeUserIds, userId], matchedUserIds);
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

    // Find best available match (not already matched)
    // Check matched user IDs once before loop (performance optimization)
    // Note: matchedUserIds may have changed since we fetched pool users, but we check once
    // to avoid unnecessary cache calls in the loop
    const currentMatched = await this.getMatchedUserIdsCached();
    
    for (const pair of scoredPairs) {
      // Check if user is still available (may have been matched by another request)
      if (!currentMatched.has(pair.user.id)) {
        // Create match (no expiration - persists until raincheck)
        await this.createMatch(userId, pair.user.id, pair.score);
        // Update both users' status to MATCHED (parallelized for performance)
        await Promise.all([
          this.updateUserStatus(userId, "MATCHED"),
          this.updateUserStatus(pair.user.id, "MATCHED")
        ]);
        return pair.user;
      }
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
        await this.createMatch(pair.user1.id, pair.user2.id, pair.score);
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
          }
        });
        return match;
      } else {
        // Fallback to raw SQL - get match (no expiration check)
        const matches = await (this.prisma as any).$queryRawUnsafe(
          `SELECT "user1Id", "user2Id", score FROM active_matches 
           WHERE "user1Id" = $1 OR "user2Id" = $1
           LIMIT 1`,
          userId
        );
        return matches && matches.length > 0 ? matches[0] : null;
      }
    } catch (error: any) {
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        return null;
      }
      // Try raw SQL fallback - get match (no expiration check)
      try {
        const matches = await (this.prisma as any).$queryRawUnsafe(
          `SELECT "user1Id", "user2Id", score FROM active_matches 
           WHERE "user1Id" = $1 OR "user2Id" = $1
           LIMIT 1`,
          userId
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
   */
  async createMatch(user1Id: string, user2Id: string, score: number): Promise<void> {
    try {
      // Ensure user1Id < user2Id for consistency
      const [id1, id2] = [user1Id, user2Id].sort();
      
      // Use raw SQL directly for reliability
      // Note: expiresAt is optional - if column exists, we can set it to a far future date or leave NULL
      const escapedId1 = id1.replace(/'/g, "''");
      const escapedId2 = id2.replace(/'/g, "''");
      
      // Try with expiresAt first (if column exists)
      try {
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO active_matches (id, "user1Id", "user2Id", score, "expiresAt", "createdAt", "updatedAt") 
           VALUES (gen_random_uuid()::text, '${escapedId1}', '${escapedId2}', ${score}, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("user1Id", "user2Id") DO NOTHING`
        );
      } catch (expiresAtError: any) {
        // If expiresAt column doesn't exist, create match without it
        if (expiresAtError?.message?.includes('expiresAt') || expiresAtError?.code === '42703') {
          await (this.prisma as any).$executeRawUnsafe(
            `INSERT INTO active_matches (id, "user1Id", "user2Id", score, "createdAt", "updatedAt") 
             VALUES (gen_random_uuid()::text, '${escapedId1}', '${escapedId2}', ${score}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT ("user1Id", "user2Id") DO NOTHING`
          );
        } else {
          throw expiresAtError;
        }
      }
      
      // Invalidate matched user IDs cache
      await this.cacheService.del("matched:user:ids");
      console.log(`[DEBUG] Created match between ${id1} and ${id2} (no expiration - persists until raincheck)`);
    } catch (error: any) {
      // If template literal fails, try unsafe with proper escaping
      try {
        const [id1, id2] = [user1Id, user2Id].sort();
        const escapedId1 = id1.replace(/'/g, "''");
        const escapedId2 = id2.replace(/'/g, "''");
        
        // Try with expiresAt as NULL (if column exists)
        try {
          await (this.prisma as any).$executeRawUnsafe(
            `INSERT INTO active_matches (id, "user1Id", "user2Id", score, "expiresAt", "createdAt", "updatedAt") 
             VALUES (gen_random_uuid()::text, '${escapedId1}', '${escapedId2}', ${score}, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT ("user1Id", "user2Id") DO NOTHING`
          );
        } catch (expiresAtError: any) {
          // If expiresAt column doesn't exist, create match without it
          if (expiresAtError?.message?.includes('expiresAt') || expiresAtError?.code === '42703') {
            await (this.prisma as any).$executeRawUnsafe(
              `INSERT INTO active_matches (id, "user1Id", "user2Id", score, "createdAt", "updatedAt") 
               VALUES (gen_random_uuid()::text, '${escapedId1}', '${escapedId2}', ${score}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT ("user1Id", "user2Id") DO NOTHING`
            );
          } else {
            throw expiresAtError;
          }
        }
        
        // Invalidate matched user IDs cache
        await this.cacheService.del("matched:user:ids");
        console.log(`[DEBUG] Created match between ${id1} and ${id2} (no expiration - persists until raincheck)`);
      } catch (unsafeError: any) {
        console.error(`Failed to create match between ${user1Id} and ${user2Id}:`, unsafeError?.message || unsafeError);
        // Don't throw - match creation failure shouldn't break the flow
      }
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
   * Update user status via user-service
   * Falls back to direct database update if API fails
   */
  async updateUserStatus(userId: string, status: string): Promise<void> {
    console.log(`[DEBUG] updateUserStatus called for user ${userId} to status ${status}`);
    // Always use direct DB update for reliability
    try {
      await this.updateUserStatusDirect(userId, status);
      // Verify the update worked
      const escapedUserId = userId.replace(/'/g, "''");
      const verifyStatus = await (this.prisma as any).$queryRawUnsafe(
        `SELECT status FROM users WHERE id = '${escapedUserId}'`
      );
      console.log(`[DEBUG] Status verification after update for user ${userId}:`, verifyStatus?.[0]?.status || 'null');
      if (verifyStatus && verifyStatus.length > 0 && verifyStatus[0].status !== status) {
        console.warn(`[DEBUG] Status update verification failed for user ${userId}, retrying...`);
        // Retry if status didn't update
        await this.updateUserStatusDirect(userId, status);
      }
    } catch (dbError) {
      console.error(`[ERROR] Direct DB update failed for user ${userId}:`, dbError);
      // Fallback to API if direct DB update fails
      try {
        const response = await fetch(`${this.userServiceUrl}/users/test/${userId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[WARN] Failed to update status via API for user ${userId}:`, errorText);
        }
      } catch (error) {
        console.error(`[ERROR] Error updating status via API for user ${userId}:`, error);
        // Don't throw - status update failure shouldn't break matching
      }
    }
  }

  /**
   * Update user status directly in database (fallback)
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
      videoEnabled: profile.videoEnabled !== undefined ? profile.videoEnabled : true
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
}

