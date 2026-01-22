import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserClientService } from "./user-client.service.js";
import { GenderFilterService } from "./gender-filter.service.js";
import { LocationService } from "./location.service.js";
import { MatchingService } from "./matching.service.js";
import { StreamingClientService } from "./streaming-client.service.js";

// DiscoveryUser interface is imported from user-client.service.ts
// Import it to avoid duplication
import type { DiscoveryUser } from "./user-client.service.js";

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
  actualCity?: string | null; // City derived from latitude/longitude (for "anywhere" mode)
  [key: string]: any;
}

interface CardPage {
  photoUrl: string;
  order: number;
  additionalInfo?: any;
}

interface Card {
  userId: string;
  username: string;
  age: number;
  displayPictureUrl: string;
  city: string;
  country: string;
  intent: string | null;
  brands: Array<{ name: string; logoUrl?: string }>;
  interests: Array<{ name: string }>;
  values: Array<{ name: string }>;
  musicPreference?: { name: string; artist: string; albumArtUrl?: string };
  pages: CardPage[];
  status: "AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE" | "ONLINE" | "OFFLINE" | "VIEWER";
  reported?: boolean;
  matchExplanation?: {
    reasons: string[];
    score: number;
    commonBrands: string[];
    commonInterests: string[];
    commonValues: string[];
    sameMusic?: boolean;
    sameCity?: boolean;
    sameVideoPreference?: boolean;
  };
}

interface LocationCard {
  type: "LOCATION";
  city: string | null; // null means "Anywhere"
  country?: string;
  state?: string;
  availableCount: number;
}

interface CardResponse {
  card: Card | LocationCard | null;
  exhausted: boolean;
  suggestedCities?: Array<{ city: string; country?: string; availableCount: number }>;
  isLocationCard?: boolean; // Flag to indicate if this is a location card
}

@Injectable()
export class DiscoveryService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userClient: UserClientService,
    private readonly genderFilterService: GenderFilterService,
    private readonly locationService: LocationService,
    private readonly matchingService: MatchingService,
    private readonly streamingClient: StreamingClientService
  ) {}

  /**
   * Get next face card for user
   */
  async getNextCard(
    token: string,
    sessionId: string,
    soloOnly: boolean = false
  ): Promise<CardResponse> {
    // Get current user profile
    const userProfileResponse = await this.userClient.getUserFullProfile(token);
    const userId = userProfileResponse.id;

    // Get user's preferred city
    const cityResponse = await this.locationService.getPreferredCity(token);
    const preferredCity = cityResponse.city;
    
    // Get viewer's actual city from location if in "anywhere" mode
    let actualCity: string | null = null;
    if (preferredCity === null && (userProfileResponse as any).latitude && (userProfileResponse as any).longitude) {
      try {
        const locationResult = await this.locationService.locateMe(
          (userProfileResponse as any).latitude,
          (userProfileResponse as any).longitude
        );
        actualCity = locationResult.city;
      } catch (error) {
        // If geocoding fails, actualCity remains null (no same city bonus)
        console.warn("Failed to get actual city from location:", error);
      }
    }
    
    // Convert to UserProfile interface
    const currentUser: UserProfile = {
      id: userProfileResponse.id,
      preferredCity: preferredCity,
      brandPreferences: (userProfileResponse as any).brandPreferences,
      interests: (userProfileResponse as any).interests,
      values: (userProfileResponse as any).values,
      musicPreference: (userProfileResponse as any).musicPreference,
      videoEnabled: (userProfileResponse as any).videoEnabled,
      actualCity: actualCity
    };

    // Check if user is already matched
    const existingMatch = await this.matchingService.getMatchForUser(userId);
    if (existingMatch) {
      // User is already matched, return their match's card
      const matchedUserId = existingMatch.user1Id === userId ? existingMatch.user2Id : existingMatch.user1Id;
      const matchedUser = await this.userClient.getUserFullProfileById(matchedUserId);
      const card = await this.buildCard(this.convertToDiscoveryUser(matchedUser), preferredCity, currentUser);
      
      // Decrement gender filter if active
      const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
      const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // User is not matched, find a match using mutual matching
    // Get gender filter preference
    const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
    const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;

    // Determine gender filter - ONLY apply when screensRemaining > 0
    let genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined;
    if (hasActiveGenderFilter) {
      const gendersJson = genderFilter.genders;
      if (typeof gendersJson === "string") {
        genders = JSON.parse(gendersJson);
      } else if (Array.isArray(gendersJson)) {
        genders = gendersJson as ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      }
    }

    // Get rainchecked user IDs for this session and city
    const raincheckedUserIds = await this.getRaincheckedUserIds(userId, sessionId, preferredCity);

    // Find match using mutual matching algorithm
    const matchedUser = await this.matchingService.findMatchForUser(
      userId,
      currentUser,
      preferredCity,
      genders,
      raincheckedUserIds
    );

    if (matchedUser) {
      const card = await this.buildCard(matchedUser, preferredCity, currentUser);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // No match found, check fallback options
    console.log(`[DEBUG] getNextCardForUser - findMatchForUser returned null for user ${userId}, city: ${preferredCity || 'null (Anywhere)'}`);
    // Determine statuses to filter
    const statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[] = soloOnly
      ? ["AVAILABLE"]
      : ["AVAILABLE", "IN_SQUAD_AVAILABLE", "IN_BROADCAST_AVAILABLE"];
    
    // If no matches found, check if we should show fallback
    if (true) {
      // If gender filter is active (screensRemaining > 0), check other cities with same gender
      if (hasActiveGenderFilter && genders && genders.length > 0) {
        // Try to find users of the same gender in other cities (anywhere)
        const usersInOtherCities = await this.findMatchingUsers(
          token,
          userId,
          null, // anywhere
          statuses,
          genders, // still apply gender filter
          soloOnly,
          [] // don't exclude rainchecked for this check
        );

        // If users exist in other cities, use them (unlimited scroll)
        if (usersInOtherCities.length > 0) {
          const selectedUser = this.selectBestMatch(usersInOtherCities, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity, currentUser);
          
          if (hasActiveGenderFilter) {
            await this.genderFilterService.decrementScreen(userId);
          }

          return {
            card,
            exhausted: false
          };
        }
        
        // If no users of this gender exist anywhere, check without gender filter
        const usersWithoutGenderFilter = await this.findMatchingUsers(
          token,
          userId,
          null, // anywhere
          statuses,
          undefined, // no gender filter
          soloOnly,
          [] // don't exclude rainchecked
        );

        if (usersWithoutGenderFilter.length > 0) {
          const selectedUser = this.selectBestMatch(usersWithoutGenderFilter, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity, currentUser);
          
          return {
            card,
            exhausted: false
          };
        }
      }

      // Before showing location cards, check if users are available (they might have just become available)
      // Check for users in preferred city first
      const usersBeforeLocation = preferredCity 
        ? await this.findMatchingUsers(
          token,
          userId,
          preferredCity,
          statuses,
          genders,
          soloOnly,
            raincheckedUserIds
          )
        : await this.findMatchingUsers(
            token,
            userId,
            null,
            statuses,
            genders,
            soloOnly,
            [] // Don't exclude rainchecked for "anywhere"
          );

      console.log(`[DEBUG] getNextCardForUser - usersBeforeLocation: ${usersBeforeLocation.length} users found for city ${preferredCity || 'null (Anywhere)'}`);

      // If users are available, show them instead of location cards
      if (usersBeforeLocation.length > 0) {
        try {
          // Use selectBestMatchAndCreate to ensure matches are created before showing card
          const selectedUser = await this.selectBestMatchAndCreate(userId, usersBeforeLocation, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity, currentUser);
          
          if (hasActiveGenderFilter) {
            await this.genderFilterService.decrementScreen(userId);
          }

          console.log(`[DEBUG] getNextCardForUser - Successfully created match and card for user ${selectedUser.id}`);
          return {
            card,
            exhausted: false
          };
        } catch (error: any) {
          console.error(`[ERROR] getNextCardForUser - Failed to create match for any candidate in usersBeforeLocation:`, error.message);
          // Continue to location cards if match creation fails
        }
      }

      // No users available - show location cards (never exhausted)
      // BUT FIRST: Double-check if users became available (they might have just become available after rainchecking)
      // Check for users again (this time don't exclude rainchecked to give fresh chances)
      const usersRecheck = preferredCity 
        ? await this.findMatchingUsers(
            token,
            userId,
            preferredCity,
            statuses,
            genders,
            soloOnly,
            [] // Don't exclude rainchecked - give users another chance
          )
        : await this.findMatchingUsers(
            token,
            userId,
            null, // anywhere - will now return users from ALL cities (not just preferredCity=null)
            statuses,
            genders,
            soloOnly,
            [] // Don't exclude rainchecked for "anywhere"
          );

      console.log(`[DEBUG] getNextCardForUser - usersRecheck: ${usersRecheck.length} users found for city ${preferredCity || 'null (Anywhere)'}`);

      // If users are now available, show them instead of location cards
      if (usersRecheck.length > 0) {
        try {
          // Use selectBestMatchAndCreate to ensure matches are created before showing card
          const selectedUser = await this.selectBestMatchAndCreate(userId, usersRecheck, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity, currentUser);
          
          if (hasActiveGenderFilter) {
            await this.genderFilterService.decrementScreen(userId);
          }

          console.log(`[DEBUG] getNextCardForUser - Successfully created match and card for user ${selectedUser.id}`);
          return {
            card,
            exhausted: false
          };
        } catch (error: any) {
          console.error(`[ERROR] getNextCardForUser - Failed to create match for any candidate in usersRecheck:`, error.message);
          // Continue to location cards if match creation fails
        }
      }
      
      // Still no users available - show location cards (never exhausted)
      // Get location cards already shown
      const locationCardsShown = await this.getLocationCardsShown(userId, sessionId);
      
      // Get available location cards
      let locationCards = await this.getLocationCards(locationCardsShown);
      
      // If all location cards are shown, clear them and cycle through again (make it feel infinite)
      if (locationCards.length === 0) {
        await this.clearLocationCards(userId, sessionId);
        // After clearing, get fresh location cards (all cities + anywhere should be available again)
        locationCards = await this.getLocationCards([]);
      }
      
      // Always return a location card (never exhausted)
      if (locationCards.length > 0) {
        const selectedLocationCard = locationCards[0];
        
        // Mark as shown
        await this.markLocationCardShown(userId, sessionId, selectedLocationCard.city);
        
        return {
          card: selectedLocationCard,
          exhausted: false,
          isLocationCard: true
        };
      }
      
      // Fallback: if somehow no location cards (should never happen), return "anywhere"
        return {
        card: {
          type: "LOCATION" as const,
          city: null, // "Anywhere"
          availableCount: await this.locationService.getAnywhereUsersCount()
        },
        exhausted: false,
        isLocationCard: true
      };
    }

    // No matches found at all - return exhausted
    return {
      card: null,
      exhausted: true
    };
  }

  /**
   * Find matching users based on filters
   */
  private async findMatchingUsers(
    token: string,
    userId: string,
    city: string | null,
    statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[],
    genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined,
    _soloOnly: boolean,
    excludeUserIds: string[]
  ): Promise<DiscoveryUser[]> {
    // Add current user to exclude list
    const excludeIds = [...excludeUserIds, userId];

    const users = await this.userClient.getUsersForDiscovery(token, {
      city,
      statuses,
      genders,
      excludeUserIds: excludeIds,
      limit: 500 // Get a large pool for matching
    });

    return users;
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
      reportCount: profile.reportCount || 0
    };
  }

  /**
   * Calculate match score based on preferences
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
    // When viewer has a city preference, all candidates are already from that city (filtered),
    // so this scoring would be redundant. Only applies when viewer is in "anywhere" mode.
    if (user.preferredCity === null && user.actualCity && targetUser.preferredCity) {
      // Viewer is in "anywhere" mode, compare viewer's actual city (from location) 
      // with target user's preferredCity
      if (user.actualCity.toLowerCase() === targetUser.preferredCity.toLowerCase()) {
        score += 50;
      }
    }
    // Note: When user.preferredCity is not null, all candidates are already filtered to that city,
    // so same city scoring is redundant (all would get +50, making it meaningless for ranking)

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
   * Create match when showing a card (ensures mutual acceptance flow works)
   */
  private async createMatchForCard(userId: string, matchedUserId: string, currentUser: UserProfile, matchedUser: DiscoveryUser): Promise<void> {
    try {
      // Check if match already exists
      const existingMatch = await this.matchingService.getMatchForUser(userId);
      if (existingMatch && (existingMatch.user1Id === matchedUserId || existingMatch.user2Id === matchedUserId)) {
        // Match already exists, just ensure statuses are MATCHED
        await Promise.all([
          this.matchingService.updateUserStatus(userId, "MATCHED"),
          this.matchingService.updateUserStatus(matchedUserId, "MATCHED")
        ]);
        console.log(`[INFO] Match already exists between ${userId} and ${matchedUserId}`);
        return;
      }
      
      // Calculate match score
      const matchScore = this.calculateMatchScore(currentUser, matchedUser);
      
      // Create match - check if it actually succeeded
      const result = await this.matchingService.createMatch(userId, matchedUserId, matchScore) as unknown as { success: boolean; error?: any };
      if (!result.success) {
        console.error(`[ERROR] createMatch failed for ${userId} and ${matchedUserId}:`, result.error);
        // Throw with full error details so they can be collected and shown
        const error = new Error(`Failed to create match: ${result.error?.message || JSON.stringify(result.error)}`);
        (error as any).code = result.error?.code;
        (error as any).details = result.error;
        (error as any).error = result.error?.message || result.error;
        throw error;
      }
      
      // Wait a bit for database consistency
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verify match was created
      let verifyMatch = await this.matchingService.getMatchForUser(userId);
      if (!verifyMatch || (verifyMatch.user1Id !== matchedUserId && verifyMatch.user2Id !== matchedUserId)) {
        verifyMatch = await this.matchingService.getMatchForUser(matchedUserId);
      }
      
      if (!verifyMatch || (verifyMatch.user1Id !== matchedUserId && verifyMatch.user2Id !== matchedUserId)) {
        console.warn(`[WARN] Match creation may have failed for ${userId} and ${matchedUserId} - match not found after creation`);
        // Try one more time with direct query
        const [id1, id2] = [userId, matchedUserId].sort();
        const escapedId1 = id1.replace(/'/g, "''");
        const escapedId2 = id2.replace(/'/g, "''");
        try {
          const directMatch = await (this.prisma as any).$queryRawUnsafe(
            `SELECT "user1Id", "user2Id" FROM active_matches 
             WHERE ("user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}')
             LIMIT 1`
          );
          if (!directMatch || directMatch.length === 0) {
            console.error(`[ERROR] Match definitely not created for ${userId} and ${matchedUserId}`);
            // Try creating again
            const retryResult = await this.matchingService.createMatch(userId, matchedUserId, matchScore) as unknown as { success: boolean; error?: any };
            if (!retryResult.success) {
              console.error(`[ERROR] Retry createMatch also failed for ${userId} and ${matchedUserId}:`, retryResult.error);
            }
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (queryError: any) {
          console.error(`[ERROR] Direct query failed:`, queryError?.message || queryError);
        }
      } else {
        console.log(`[INFO] Verified match created between ${userId} and ${matchedUserId}`);
      }
      
      // Update both users' status to MATCHED
      await Promise.all([
        this.matchingService.updateUserStatus(userId, "MATCHED"),
        this.matchingService.updateUserStatus(matchedUserId, "MATCHED")
      ]);
      
      console.log(`[INFO] Created match between ${userId} and ${matchedUserId} when showing card`);
    } catch (error: any) {
      console.error(`[ERROR] Failed to create match when showing card:`, error?.message || error);
      console.error(`[ERROR] Error details:`, {
        code: error?.code,
        message: error?.message,
        detail: error?.detail,
        hint: error?.hint
      });
      // Re-throw the error - cards should NOT be shown if match creation fails
      // This ensures matches exist before cards are displayed
      throw error;
    }
  }

  /**
   * Select best match from candidates
   */
  private selectBestMatch(
    candidates: DiscoveryUser[],
    currentUser: UserProfile
  ): DiscoveryUser {
    if (candidates.length === 0) {
      throw new HttpException("No candidates available", HttpStatus.NOT_FOUND);
    }

    // Calculate scores for all candidates
    const scored = candidates.map((user) => ({
      user,
      score: this.calculateMatchScore(currentUser, user)
    }));

    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);

    // Group by score and randomize within same score groups
    const scoreGroups = new Map<number, DiscoveryUser[]>();
    for (const item of scored) {
      if (!scoreGroups.has(item.score)) {
        scoreGroups.set(item.score, []);
      }
      scoreGroups.get(item.score)!.push(item.user);
    }

    // Get highest score group
    const highestScore = Math.max(...Array.from(scoreGroups.keys()));
    const highestScoreGroup = scoreGroups.get(highestScore)!;

    // Randomize within highest score group
    const randomIndex = Math.floor(Math.random() * highestScoreGroup.length);
    return highestScoreGroup[randomIndex];
  }

  /**
   * Select best match and create match record (for mutual acceptance flow)
   * Tries multiple candidates if match creation fails for the best match
   */
  private async selectBestMatchAndCreate(
    userId: string,
    candidates: DiscoveryUser[],
    currentUser: UserProfile
  ): Promise<DiscoveryUser> {
    // Sort candidates by score (best first)
    const scoredCandidates = candidates.map(candidate => ({
      candidate,
      score: this.calculateMatchScore(currentUser, candidate)
    })).sort((a, b) => b.score - a.score);
    
    const errors: any[] = [];
    
    // Try each candidate until we find one where match creation succeeds
    for (const { candidate } of scoredCandidates) {
      try {
        // Try to create match - if it fails, try next candidate
        await this.createMatchForCard(userId, candidate.id, currentUser, candidate);
        // Success - return this candidate
        return candidate;
      } catch (error: any) {
        // Extract the actual database error from nested error objects
        const actualError = error?.details?.error || error?.error || error?.response?.data?.error || error;
        const errorCode = error?.code || error?.details?.code || error?.response?.data?.code || actualError?.code;
        const errorMessage = error?.message || error?.details?.message || error?.response?.data?.message || actualError?.message || actualError;
        const errorDetail = error?.details || actualError?.details || actualError?.detail || actualError;
        const errorHint = error?.hint || actualError?.hint;
        
        const errorDetails = {
          candidateId: candidate.id,
          error: errorMessage,
          code: errorCode,
          details: errorDetail,
          hint: errorHint,
          fullError: error // Include full error for debugging
        };
        console.error(`[ERROR] Failed to create match for candidate ${candidate.id}:`, errorDetails);
        console.error(`[ERROR] Full error object:`, JSON.stringify(error, null, 2));
        errors.push(errorDetails);
        // Continue to next candidate
        continue;
      }
    }
    
    // If all candidates failed, throw error with actual database error details
    const firstError = errors[0];
    const errorMessage = firstError?.error || 'Match creation failed for all available users';
    const errorCode = firstError?.code || 'MATCH_CREATION_FAILED_ALL';
    const errorDetails = firstError?.details || {};
    const errorHint = firstError?.hint;
    
    // Build detailed suggestion based on error code
    let suggestion = `Database error occurred. Please check:`;
    if (errorCode === '42P01' || errorMessage?.includes('does not exist')) {
      suggestion = `Table 'active_matches' does not exist. Run: prisma db push or prisma migrate dev`;
    } else if (errorCode === '42703' || errorMessage?.includes('column')) {
      suggestion = `Table schema mismatch. Check: 1) Column names match Prisma schema, 2) Run prisma db push`;
    } else if (errorCode === '23505' || errorMessage?.includes('unique constraint')) {
      suggestion = `Unique constraint violation. This might indicate a race condition or duplicate match attempt.`;
    } else if (errorCode === '08006' || errorMessage?.includes('connection')) {
      suggestion = `Database connection error. Check: 1) DATABASE_URL is correct, 2) Database is running, 3) Network connectivity`;
    } else {
      suggestion = `Check: 1) Database connection, 2) active_matches table exists, 3) Table schema matches Prisma schema. Error code: ${errorCode || 'Unknown'}`;
    }
    if (errorHint) {
      suggestion += `\n\nDatabase hint: ${errorHint}`;
    }
    
    throw new HttpException(
      {
        message: `Failed to create match for any candidate (tried ${errors.length} candidates)`,
        error: errorMessage,
        code: errorCode,
        details: {
          totalCandidates: scoredCandidates.length,
          failedAttempts: errors.length,
          firstError: {
            candidateId: firstError?.candidateId,
            error: firstError?.error,
            code: firstError?.code,
            details: errorDetails,
            hint: errorHint
          },
          allErrors: errors.slice(0, 3).map(e => ({
            candidateId: e.candidateId,
            error: e.error,
            code: e.code
          }))
        },
        suggestion: suggestion
      },
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  /**
   * Build card response from user data
   */
  private async buildCard(
    user: DiscoveryUser, 
    _currentCity: string | null,
    currentUser?: UserProfile
  ): Promise<Card> {
    // Calculate age accurately
    let age = 0;
    if (user.dateOfBirth) {
      const today = new Date();
      const birthDate = new Date(user.dateOfBirth);
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }

    // Build pages array (display picture + additional photos)
    const pages: CardPage[] = [];

    // Page 0: Display picture
    if (user.displayPictureUrl) {
      pages.push({
        photoUrl: user.displayPictureUrl,
        order: 0
      });
    }

    // Pages 1-4: Additional photos
    for (const photo of user.photos.slice(0, 4)) {
      pages.push({
        photoUrl: photo.url,
        order: photo.order + 1 // Start from 1
      });
    }

    // Extract city name (preferredCity is just the city name string)
    const city = user.preferredCity || "Unknown";
    // Country is not stored separately in preferredCity, would need separate field if needed
    const country = undefined;

    // Check if user is reported (check reportCount against threshold)
    const reportThreshold = parseInt(process.env.REPORT_THRESHOLD || "5", 10);
    const isReported = (user.reportCount || 0) >= reportThreshold;

    // Calculate match explanation if currentUser is provided
    let matchExplanation: Card["matchExplanation"] | undefined;
    if (currentUser) {
      matchExplanation = this.calculateMatchExplanation(currentUser, user);
    }

    return {
      userId: user.id,
      username: user.username || "Unknown",
      age,
      displayPictureUrl: user.displayPictureUrl || "",
      city,
      country: country || "",
      intent: user.intent || null,
      brands: user.brandPreferences.map((bp) => ({
        name: bp.brand.name,
        logoUrl: bp.brand.logoUrl || undefined
      })),
      interests: user.interests.map((i) => ({
        name: i.interest.name
      })),
      values: user.values.map((v) => ({
        name: v.value.name
      })),
      musicPreference: user.musicPreference
        ? {
            name: user.musicPreference.name,
            artist: user.musicPreference.artist,
            albumArtUrl: user.musicPreference.albumArtUrl || undefined
          }
        : undefined,
      pages,
      status: user.status as "AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE" | "ONLINE" | "OFFLINE" | "VIEWER",
      reported: isReported,
      matchExplanation
    };
  }

  /**
   * Calculate match explanation - why these users matched
   */
  private calculateMatchExplanation(
    currentUser: UserProfile,
    matchedUser: DiscoveryUser
  ): Card["matchExplanation"] {
    const reasons: string[] = [];
    const commonBrands: string[] = [];
    const commonInterests: string[] = [];
    const commonValues: string[] = [];
    let sameMusic = false;
    let sameCity = false;
    let sameVideoPreference = false;

    // Common brands
    const userBrandIds = new Set((currentUser.brandPreferences || []).map(bp => bp.brand.id));
    for (const bp of matchedUser.brandPreferences) {
      if (userBrandIds.has(bp.brand.id)) {
        commonBrands.push(bp.brand.name);
      }
    }
    if (commonBrands.length > 0) {
      reasons.push(`Shared ${commonBrands.length} brand${commonBrands.length > 1 ? 's' : ''}: ${commonBrands.slice(0, 3).join(', ')}${commonBrands.length > 3 ? '...' : ''}`);
    }

    // Common interests
    const userInterestIds = new Set((currentUser.interests || []).map(i => i.interest.id));
    for (const interest of matchedUser.interests) {
      if (userInterestIds.has(interest.interest.id)) {
        commonInterests.push(interest.interest.name);
      }
    }
    if (commonInterests.length > 0) {
      reasons.push(`Shared ${commonInterests.length} interest${commonInterests.length > 1 ? 's' : ''}: ${commonInterests.slice(0, 3).join(', ')}${commonInterests.length > 3 ? '...' : ''}`);
    }

    // Common values
    const userValueIds = new Set((currentUser.values || []).map(v => v.value.id));
    for (const value of matchedUser.values) {
      if (userValueIds.has(value.value.id)) {
        commonValues.push(value.value.name);
      }
    }
    if (commonValues.length > 0) {
      reasons.push(`Shared ${commonValues.length} value${commonValues.length > 1 ? 's' : ''}: ${commonValues.slice(0, 3).join(', ')}${commonValues.length > 3 ? '...' : ''}`);
    }

    // Same music preference
    if (currentUser.musicPreference?.id && matchedUser.musicPreference?.id) {
      if (currentUser.musicPreference.id === matchedUser.musicPreference.id) {
        sameMusic = true;
        reasons.push(`Same music taste: ${matchedUser.musicPreference.name}`);
      }
    }

    // Same city
    if (currentUser.preferredCity && matchedUser.preferredCity) {
      if (currentUser.preferredCity.toLowerCase() === matchedUser.preferredCity.toLowerCase()) {
        sameCity = true;
        reasons.push(`Same city: ${matchedUser.preferredCity}`);
      }
    } else if (currentUser.actualCity && matchedUser.preferredCity) {
      if (currentUser.actualCity.toLowerCase() === matchedUser.preferredCity.toLowerCase()) {
        sameCity = true;
        reasons.push(`Same city: ${matchedUser.preferredCity}`);
      }
    }

    // Same video preference
    if (currentUser.videoEnabled !== undefined && matchedUser.videoEnabled !== undefined) {
      if (currentUser.videoEnabled === matchedUser.videoEnabled) {
        sameVideoPreference = true;
        reasons.push(`Same video preference: ${matchedUser.videoEnabled ? 'Video enabled' : 'Video disabled'}`);
      }
    }

    // Calculate match score
    const score = this.calculateMatchScore(currentUser, matchedUser);

    // If no specific reasons, add a generic one
    if (reasons.length === 0) {
      reasons.push("Good compatibility match");
    }

    return {
      reasons,
      score: Math.round(score),
      commonBrands,
      commonInterests,
      commonValues,
      sameMusic,
      sameCity,
      sameVideoPreference
    };
  }

  /**
   * Get rainchecked user IDs for current session and city
   */
  private async getRaincheckedUserIds(
    userId: string,
    sessionId: string,
    city: string | null
  ): Promise<string[]> {
    try {
      const rainchecks = await (this.prisma as any).raincheckSession.findMany({
        where: {
          userId,
          sessionId,
          city: city || null,
          raincheckedUserId: {
            not: {
              startsWith: "LOCATION:"
            }
          }
        },
      select: {
        raincheckedUserId: true
      }
    });

    return rainchecks.map((r: { raincheckedUserId: string }) => r.raincheckedUserId);
    } catch (error: any) {
      // If table doesn't exist or other Prisma error, return empty array
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("Raincheck table not found, returning empty array:", error.message);
        return [];
      }
      console.error("Error fetching rainchecked users:", error);
      return [];
    }
  }

  /**
   * Get location cards shown for this session
   */
  private async getLocationCardsShown(
    userId: string,
    sessionId: string
  ): Promise<string[]> {
    // Use a special marker in raincheck session to track location cards
    // We'll use a special prefix like "LOCATION:" for city names
    const locationRainchecks = await (this.prisma as any).raincheckSession.findMany({
      where: {
        userId,
        sessionId,
        raincheckedUserId: {
          startsWith: "LOCATION:"
        }
      },
      select: {
        raincheckedUserId: true
      }
    });

    return locationRainchecks.map((r: { raincheckedUserId: string }) => 
      r.raincheckedUserId.replace("LOCATION:", "")
    );
  }

  /**
   * Mark location card as shown
   */
  private async markLocationCardShown(
    userId: string,
    sessionId: string,
    city: string | null
  ): Promise<void> {
    const locationId = `LOCATION:${city || "ANYWHERE"}`;
    
    const existing = await (this.prisma as any).raincheckSession.findFirst({
      where: {
        userId,
        sessionId,
        raincheckedUserId: locationId
      }
    });

    if (!existing) {
      await (this.prisma as any).raincheckSession.create({
        data: {
          userId,
          sessionId,
          raincheckedUserId: locationId,
          city: null // Location cards don't have a city context
        }
      });
    }
  }

  /**
   * Get random location cards (8-10 cities + "anywhere")
   * Always includes "anywhere" option
   */
  private async getLocationCards(
    excludeCities: string[] = []
  ): Promise<LocationCard[]> {
    // Get top cities (more than needed for randomization)
    const allCities = await this.locationService.getCitiesWithMaxUsers(100);
    
    // Calculate "Anywhere" count:
    // - Users with preferredCity = null (didn't select a city)
    // - PLUS all available users from all cities (because "Anywhere" sees everyone)
    const nullCityUsersCount = await this.locationService.getAnywhereUsersCount();
    const totalCityUsers = allCities.reduce((sum, city) => sum + city.availableCount, 0);
    // "Anywhere" = users with null city + all users from all cities
    // Note: Users with null city are NOT included in city counts (city query filters WHERE preferredCity IS NOT NULL)
    // So we need to add them separately
    const anywhereCount = nullCityUsersCount + totalCityUsers;
    
    // Check if "anywhere" was already shown (it's stored as "ANYWHERE" in excludeCities)
    const anywhereShown = excludeCities.includes("ANYWHERE") || excludeCities.includes(null as any);
    
    // Filter out excluded cities (include "anywhere" in exclusion if it was shown)
    const excludeCitiesFiltered = excludeCities.filter(c => c !== "ANYWHERE" && c !== null);
    const availableCities = allCities.filter(
      c => !excludeCitiesFiltered.includes(c.city)
    );
    
    // Randomly select 8-10 cities
    const count = Math.min(8 + Math.floor(Math.random() * 3), availableCities.length); // 8-10 cities
    const shuffled = [...availableCities].sort(() => Math.random() - 0.5);
    const selectedCities = shuffled.slice(0, count);
    
    // Build location cards
    const locationCards: LocationCard[] = [
      ...selectedCities.map(c => ({
        type: "LOCATION" as const,
        city: c.city,
        availableCount: c.availableCount
      }))
    ];
    
    // Always include "Anywhere" to make location cards feel infinite
    // After clearing (when excludeCities is empty), all location cards cycle back including "anywhere"
    // The check ensures we don't show "anywhere" twice in the same cycle, but it will reappear after clearing
    if (!anywhereShown || excludeCities.length === 0) {
      // Include "anywhere" if:
      // 1. It hasn't been shown yet in this cycle (!anywhereShown), OR
      // 2. All location cards were cleared (excludeCities is empty), meaning we're starting a new cycle
      locationCards.push({
        type: "LOCATION" as const,
        city: null, // "Anywhere"
        availableCount: anywhereCount // Users with null city + all users from all cities
      });
    }
    
    // Shuffle again to randomize "Anywhere" position (if it's included)
    return locationCards.sort(() => Math.random() - 0.5);
  }

  /**
   * Mark user as rainchecked
   * When a user rainchecks, both users are rematched with new partners
   */
  async markRaincheck(
    userId: string,
    sessionId: string,
    raincheckedUserId: string,
    city: string | null
  ): Promise<void> {
    try {
      // Check if users are matched with each other
      const match = await this.matchingService.getMatchForUser(userId);
      if (match && (match.user1Id === raincheckedUserId || match.user2Id === raincheckedUserId)) {
        // Users are matched with each other, break the match
        await this.matchingService.removeMatch(userId, raincheckedUserId);
      }

      // When one user rainchecks, BOTH users should reset to AVAILABLE
      // This allows both to see new cards and get new matches
      try {
        // Reset rainchecked user to AVAILABLE
        const raincheckedUserProfile = await this.userClient.getUserFullProfileById(raincheckedUserId);
        if (raincheckedUserProfile.status === 'MATCHED') {
          console.log(`[DEBUG] Resetting rainchecked user ${raincheckedUserId} status from MATCHED to AVAILABLE (due to raincheck)`);
          await this.matchingService.updateUserStatus(raincheckedUserId, "AVAILABLE");
          console.log(`[DEBUG] Status reset completed for rainchecked user ${raincheckedUserId}`);
        }
        
        // Also reset current user to AVAILABLE (they rainchecked, so they want to see new cards)
        const currentUserProfile = await this.userClient.getUserFullProfileById(userId);
        if (currentUserProfile.status === 'MATCHED') {
          console.log(`[DEBUG] Resetting current user ${userId} status from MATCHED to AVAILABLE (they rainchecked)`);
          await this.matchingService.updateUserStatus(userId, "AVAILABLE");
          console.log(`[DEBUG] Status reset completed for current user ${userId}`);
        }
      } catch (error) {
        console.error(`[ERROR] Failed to check/reset user statuses after raincheck:`, error);
        // Continue anyway - raincheck should still be recorded
      }

      // Mark as rainchecked in session (bidirectionally - both users should exclude each other)
      const existing1 = await (this.prisma as any).raincheckSession.findFirst({
        where: {
          userId,
          sessionId,
          raincheckedUserId,
          city: city || null
        }
      });

      if (!existing1) {
        await (this.prisma as any).raincheckSession.create({
          data: {
            userId,
            sessionId,
            raincheckedUserId,
            city: city || null
          }
        });
      }

      // Also record the reverse raincheck (User B should also exclude User A)
      const existing2 = await (this.prisma as any).raincheckSession.findFirst({
        where: {
          userId: raincheckedUserId,
          sessionId,
          raincheckedUserId: userId,
          city: city || null
        }
      });

      if (!existing2) {
        await (this.prisma as any).raincheckSession.create({
          data: {
            userId: raincheckedUserId,
            sessionId,
            raincheckedUserId: userId,
            city: city || null
          }
        });
      }

      // Trigger rematching for both users
      // Get user profiles for rematching
      const user1Profile = await this.userClient.getUserFullProfileById(userId);
      const user2Profile = await this.userClient.getUserFullProfileById(raincheckedUserId);
      
      const user1ProfileData: UserProfile = {
        id: user1Profile.id,
        preferredCity: user1Profile.preferredCity,
        brandPreferences: user1Profile.brandPreferences,
        interests: user1Profile.interests,
        values: user1Profile.values,
        musicPreference: user1Profile.musicPreference,
        videoEnabled: user1Profile.videoEnabled,
        actualCity: null
      };

      const user2ProfileData: UserProfile = {
        id: user2Profile.id,
        preferredCity: user2Profile.preferredCity,
        brandPreferences: user2Profile.brandPreferences,
        interests: user2Profile.interests,
        values: user2Profile.values,
        musicPreference: user2Profile.musicPreference,
        videoEnabled: user2Profile.videoEnabled,
        actualCity: null
      };

      // Get rainchecked users for both
      const rainchecked1 = await this.getRaincheckedUserIds(userId, sessionId, user1Profile.preferredCity);
      const rainchecked2 = await this.getRaincheckedUserIds(raincheckedUserId, sessionId, user2Profile.preferredCity);
      
      console.log(`[DEBUG] Rematching after raincheck - User ${userId} rainchecked list:`, rainchecked1);
      console.log(`[DEBUG] Rematching after raincheck - User ${raincheckedUserId} rainchecked list:`, rainchecked2);

      // Rematch both users (async, don't wait)
      this.matchingService.findMatchForUser(
        userId,
        user1ProfileData,
        user1Profile.preferredCity,
        undefined,
        rainchecked1
      ).catch(err => console.error("Failed to rematch user 1:", err));

      this.matchingService.findMatchForUser(
        raincheckedUserId,
        user2ProfileData,
        user2Profile.preferredCity,
        undefined,
        rainchecked2
      ).catch(err => console.error("Failed to rematch user 2:", err));
    } catch (error: any) {
      // If table doesn't exist, log warning but don't fail
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("Raincheck table not found, skipping raincheck:", error.message);
        return;
      }
      throw error;
    }
  }

  /**
   * Reset rainchecked users for a session (when city changes)
   */
  async resetSession(userId: string, sessionId: string, city: string | null): Promise<void> {
    try {
      // Use raw SQL for reliability
      if (city !== null) {
        await (this.prisma as any).$executeRawUnsafe(
          `DELETE FROM raincheck_sessions WHERE "userId" = $1 AND "sessionId" = $2 AND city = $3`,
          userId,
          sessionId,
          city
        );
      } else {
        await (this.prisma as any).$executeRawUnsafe(
          `DELETE FROM raincheck_sessions WHERE "userId" = $1 AND "sessionId" = $2`,
          userId,
          sessionId
        );
      }
    } catch (error: any) {
      // Fallback to Prisma method
      try {
        if (city !== null) {
          await (this.prisma as any).raincheckSession.deleteMany({
            where: {
              userId,
              sessionId,
              city: city
            }
          });
        } else {
          await (this.prisma as any).raincheckSession.deleteMany({
            where: {
              userId,
              sessionId
            }
          });
        }
      } catch (prismaError: any) {
        // If table doesn't exist, log warning but don't fail
        if (prismaError?.code === 'P2021' || prismaError?.message?.includes('does not exist')) {
          console.warn("Raincheck table not found, skipping reset:", prismaError.message);
          return;
        }
        throw prismaError;
      }
    }
  }

  /**
   * Clear location cards for a session
   */
  async clearLocationCards(userId: string, sessionId: string): Promise<void> {
    await (this.prisma as any).raincheckSession.deleteMany({
      where: {
        userId,
        sessionId,
        raincheckedUserId: {
          startsWith: "LOCATION:"
        }
      }
    });
  }

  /**
   * Get fallback cities when current city is exhausted
   */
  async getFallbackCities(limit: number = 10): Promise<
    Array<{ city: string; country?: string; availableCount: number }>
  > {
    const cities = await this.locationService.getCitiesWithMaxUsers(limit);
    return cities.map((c) => ({
      city: c.city,
      availableCount: c.availableCount
    }));
  }

  /**
   * Proceed with matched user (both users proceed to IN_SQUAD)
   * Removes the match and updates both users' status to IN_SQUAD
   */
  async proceedWithMatch(userId: string, matchedUserId: string, timeoutSeconds?: number): Promise<{ 
    roomId?: string; 
    sessionId?: string;
    waiting?: boolean;
    message?: string;
  }> {
    // Verify that users are actually matched
    let match = await this.matchingService.getMatchForUser(userId);
    
    // If no match exists, create one (for test flow - allows proceeding with any card)
    // In production, matches are created when cards are shown via findMatchForUser
    if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
      // Check if the matched user is already matched to someone else
      const matchedUserMatch = await this.matchingService.getMatchForUser(matchedUserId);
      if (matchedUserMatch && matchedUserMatch.user1Id !== userId && matchedUserMatch.user2Id !== userId) {
        throw new HttpException(
          `User ${matchedUserId} is already matched with another user`,
          HttpStatus.BAD_REQUEST
        );
      }
      
      // Create a match with a default score (for test flow)
      // This allows proceeding with any card shown, even if mutual matching didn't create it
      try {
        const result = await this.matchingService.createMatch(userId, matchedUserId, 100) as unknown as { success: boolean; error?: any };
        if (!result.success) {
          throw new HttpException(
            {
              message: `Could not create match for ${userId} and ${matchedUserId}`,
              error: result.error?.message || 'Database error',
              code: result.error?.code,
              details: result.error,
              suggestion: 'Please check: 1) Database connection, 2) active_matches table exists, 3) Table schema is correct.'
            },
            HttpStatus.BAD_REQUEST
          );
        }
        
        // Wait a bit for database consistency
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Get the newly created match
        match = await this.matchingService.getMatchForUser(userId);
        if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
          match = await this.matchingService.getMatchForUser(matchedUserId);
        }
      } catch (error: any) {
        console.error(`[ERROR] Failed to create match:`, error?.message || error);
        // Try to get existing match
        match = await this.matchingService.getMatchForUser(userId);
        if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
          match = await this.matchingService.getMatchForUser(matchedUserId);
        }
      }
      
        // If match still doesn't exist after retries, create it with more attempts
      if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
        console.warn(`[WARN] Match not found, creating it now for ${userId} and ${matchedUserId}`);
        
        // Try multiple times with increasing delays
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await this.matchingService.createMatch(userId, matchedUserId, 100) as unknown as { success: boolean; error?: any };
            if (!result.success) {
              throw new HttpException(
                {
                  message: `Could not create match for ${userId} and ${matchedUserId} (attempt ${attempt + 1})`,
                  error: result.error?.message || 'Database error',
                  code: result.error?.code,
                  details: result.error,
                  suggestion: 'Please check: 1) Database connection, 2) active_matches table exists, 3) Table schema is correct.'
                },
                HttpStatus.BAD_REQUEST
              );
            }
            await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1))); // 300ms, 600ms, 900ms
            
            // Try to get match by both user IDs
            match = await this.matchingService.getMatchForUser(userId);
            if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
              match = await this.matchingService.getMatchForUser(matchedUserId);
            }
            
            // If we found the match, break out of retry loop
            if (match && (match.user1Id === matchedUserId || match.user2Id === matchedUserId)) {
              console.log(`[INFO] Match created successfully on attempt ${attempt + 1}`);
              break;
            }
          } catch (createError: any) {
            const errorDetails = {
              message: createError?.message || 'Unknown error',
              code: createError?.code,
              stack: createError?.stack
            };
            console.error(`[ERROR] Attempt ${attempt + 1} to create match failed:`, errorDetails);
            if (attempt === 2) {
              // Last attempt failed - include full error details
              throw new HttpException(
                {
                  message: `Could not create match for ${userId} and ${matchedUserId} after multiple attempts`,
                  error: createError?.message || 'Unknown error',
                  code: createError?.code,
                  details: `Database error occurred. Please check: 1) Database connection, 2) active_matches table exists, 3) Table schema is correct. Original error: ${createError?.message || 'Unknown'}`,
                  suggestion: 'Please try getting a new card first or check service logs for database errors.'
                },
                HttpStatus.BAD_REQUEST
              );
            }
          }
        }
      }
      
      // Update statuses to MATCHED if not already
      if (match && (match.user1Id === matchedUserId || match.user2Id === matchedUserId)) {
        await Promise.all([
          this.matchingService.updateUserStatus(userId, "MATCHED"),
          this.matchingService.updateUserStatus(matchedUserId, "MATCHED")
        ]);
      }
    }

    // Final check - if match still doesn't exist, try one more time with raw query
    if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
      console.error(`[ERROR] Match still not found after all attempts for ${userId} and ${matchedUserId}`);
      console.error(`[DEBUG] Attempting direct database query...`);
      
      // Try to query the database directly to see if match exists
      try {
        const [id1, id2] = [userId, matchedUserId].sort();
        const escapedId1 = id1.replace(/'/g, "''");
        const escapedId2 = id2.replace(/'/g, "''");
        
        const directMatch = await (this.prisma as any).$queryRawUnsafe(
          `SELECT "user1Id", "user2Id", score FROM active_matches 
           WHERE ("user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}')
           OR ("user1Id" = '${escapedId2}' AND "user2Id" = '${escapedId1}')
           LIMIT 1`
        );
        
        if (directMatch && directMatch.length > 0) {
          match = directMatch[0];
          console.log(`[INFO] Found match via direct database query`);
          // Update statuses
          await Promise.all([
            this.matchingService.updateUserStatus(userId, "MATCHED"),
            this.matchingService.updateUserStatus(matchedUserId, "MATCHED")
          ]);
        } else {
          // Match truly doesn't exist - create it now as a fallback
          console.warn(`[WARN] Match not in database, creating it now as fallback`);
          try {
            const result = await this.matchingService.createMatch(userId, matchedUserId, 100) as unknown as { success: boolean; error?: any };
            if (!result.success) {
              throw new HttpException(
                {
                  message: `Could not create match for ${userId} and ${matchedUserId}`,
                  error: result.error?.message || 'Database error',
                  code: result.error?.code,
                  details: result.error,
                  suggestion: 'Please check: 1) Database connection, 2) active_matches table exists, 3) Table schema is correct.'
                },
                HttpStatus.BAD_REQUEST
              );
            }
            await new Promise(resolve => setTimeout(resolve, 400));
            
            // Try to get it again
            match = await this.matchingService.getMatchForUser(userId);
            if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
              match = await this.matchingService.getMatchForUser(matchedUserId);
            }
            
            // Try direct query one more time
            if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
              const directMatch2 = await (this.prisma as any).$queryRawUnsafe(
                `SELECT "user1Id", "user2Id", score FROM active_matches 
                 WHERE ("user1Id" = '${escapedId1}' AND "user2Id" = '${escapedId2}')
                 LIMIT 1`
              );
              if (directMatch2 && directMatch2.length > 0) {
                match = directMatch2[0];
              }
            }
            
            if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
              throw new HttpException(
                {
                  message: `Match not found for ${userId} and ${matchedUserId}`,
                  error: 'Match creation succeeded but match not found in database',
                  code: 'MATCH_NOT_FOUND_AFTER_CREATION',
                  details: 'Match was created but could not be retrieved. This may indicate a database consistency issue.',
                  suggestion: 'Please try getting a new card first or check service logs for database errors.'
                },
                HttpStatus.BAD_REQUEST
              );
            }
            
            // Update statuses
            await Promise.all([
              this.matchingService.updateUserStatus(userId, "MATCHED"),
              this.matchingService.updateUserStatus(matchedUserId, "MATCHED")
            ]);
          } catch (fallbackError: any) {
            const errorDetails = {
              message: fallbackError?.message || 'Unknown error',
              code: fallbackError?.code || 'UNKNOWN_ERROR',
              detail: fallbackError?.detail,
              hint: fallbackError?.hint
            };
            console.error(`[ERROR] Fallback match creation failed:`, errorDetails);
            throw new HttpException(
              {
                message: `Match not found for ${userId} and ${matchedUserId}`,
                error: fallbackError?.message || 'Unknown error',
                code: fallbackError?.code || 'UNKNOWN_ERROR',
                details: errorDetails,
                suggestion: 'Please try getting a new card first or check service logs for database errors. Common issues: 1) Database connection, 2) Table schema mismatch, 3) Permission errors.'
              },
              HttpStatus.BAD_REQUEST
            );
          }
        }
      } catch (dbError: any) {
        console.error(`[ERROR] Direct database query failed:`, dbError?.message || dbError);
        // If it's already an HttpException, re-throw it
        if (dbError instanceof HttpException) {
          throw dbError;
        }
        throw new HttpException(
          `Match not found for ${userId} and ${matchedUserId}. Please try getting a new card first.`,
          HttpStatus.BAD_REQUEST
        );
      }
    }

    // Ensure match exists before proceeding with acceptance
    if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
      throw new HttpException(
        `Match not found for ${userId} and ${matchedUserId} after all attempts. Please try getting a new card first.`,
        HttpStatus.BAD_REQUEST
      );
    }

    // Get acceptance timeout from parameter, environment variable, or default (30 seconds for testing, 5 seconds for production)
    // This is the timeout after one user accepts - wait for the other to accept
    const acceptanceTimeoutSeconds = timeoutSeconds || parseInt(process.env.MATCH_ACCEPTANCE_TIMEOUT_SECONDS || "30", 10);

    // Record this user's acceptance with acceptance timeout (5 seconds)
    await this.matchingService.recordMatchAcceptance(
      match.user1Id,
      match.user2Id,
      userId,
      acceptanceTimeoutSeconds
    );

    // Check if both users have accepted
    const bothAccepted = await this.matchingService.checkBothAccepted(
      match.user1Id,
      match.user2Id
    );

    if (bothAccepted) {
      // Both users have accepted - proceed to IN_SQUAD
      await this.matchingService.removeMatch(match.user1Id, match.user2Id);
      await this.matchingService.removeMatchAcceptances(match.user1Id, match.user2Id);
      
      // IMPORTANT: Create room FIRST while users are still MATCHED status
      // Room service expects users to be MATCHED when creating rooms
      let roomResult: { roomId?: string; sessionId?: string } = {};
      try {
        roomResult = await this.streamingClient.createMatchedRoom([match.user1Id, match.user2Id]);
        console.log(`[INFO] Created streaming room ${roomResult.roomId} for matched users`);
      } catch (error: any) {
        console.error(`[ERROR] Failed to create streaming room:`, error?.message || error);
        // Don't throw - room creation failure shouldn't block the match
        // Frontend can create room separately if needed
      }
      
      // THEN update both users' status to IN_SQUAD (after room is created)
      // Note: Room service will also update statuses, but we do it here too for consistency
      await this.matchingService.updateUserStatus(match.user1Id, "IN_SQUAD");
      await this.matchingService.updateUserStatus(match.user2Id, "IN_SQUAD");
      
      console.log(`[INFO] Both users accepted match - ${match.user1Id} and ${match.user2Id} moved to IN_SQUAD`);
      
      return roomResult;
    } else {
      // Only one user has accepted - wait for the other user
      console.log(`[INFO] User ${userId} accepted match, waiting for ${matchedUserId} to accept`);
      // The match will expire if the other user doesn't accept within the timeout
      // Cleanup will be handled by the cleanupExpiredMatches function
      return {
        waiting: true,
        message: `Waiting for ${matchedUserId} to accept. You'll enter streaming when both users accept.`
      };
    }
  }

  /**
   * Get next card for user (test mode - bypasses auth, accepts userId directly)
   */
  async getNextCardForUser(
    userId: string,
    sessionId: string,
    soloOnly: boolean = false
  ): Promise<CardResponse> {
    // Get current user profile directly by userId
    const userProfileResponse = await this.userClient.getUserFullProfileById(userId);
    
    // Get user's preferred city directly
    const preferredCity = await this.userClient.getPreferredCityById(userId);
    
    // Get viewer's actual city from location if in "anywhere" mode
    let actualCity: string | null = null;
    if (preferredCity === null && (userProfileResponse as any).latitude && (userProfileResponse as any).longitude) {
      try {
        const locationResult = await this.locationService.locateMe(
          (userProfileResponse as any).latitude,
          (userProfileResponse as any).longitude
        );
        actualCity = locationResult.city;
      } catch (error) {
        // If geocoding fails, actualCity remains null (no same city bonus)
        console.warn("Failed to get actual city from location:", error);
      }
    }
    
    // Convert to UserProfile interface
    const currentUser: UserProfile = {
      id: userProfileResponse.id,
      preferredCity: preferredCity,
      brandPreferences: (userProfileResponse as any).brandPreferences,
      interests: (userProfileResponse as any).interests,
      values: (userProfileResponse as any).values,
      musicPreference: (userProfileResponse as any).musicPreference,
      videoEnabled: (userProfileResponse as any).videoEnabled,
      actualCity: actualCity
    };

    // Check if user is already matched
    const existingMatch = await this.matchingService.getMatchForUser(userId);
    if (existingMatch) {
      // User is already matched, return their match's card
      const matchedUserId = existingMatch.user1Id === userId ? existingMatch.user2Id : existingMatch.user1Id;
      const matchedUser = await this.userClient.getUserFullProfileById(matchedUserId);
      const card = await this.buildCard(this.convertToDiscoveryUser(matchedUser), preferredCity, currentUser);
      
      // Decrement gender filter if active
      const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
      const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // User is not matched, find a match using mutual matching
    // Get gender filter preference
    const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
    const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;

    // Determine gender filter - ONLY apply when screensRemaining > 0
    let genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined;
    if (hasActiveGenderFilter) {
      const gendersJson = genderFilter.genders;
      if (typeof gendersJson === "string") {
        genders = JSON.parse(gendersJson);
      } else if (Array.isArray(gendersJson)) {
        genders = gendersJson as ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      }
    }

    // Get rainchecked user IDs for this session and city
    const raincheckedUserIds = await this.getRaincheckedUserIds(userId, sessionId, preferredCity);

    // Find match using mutual matching algorithm
    // When user A sees user B's card, they are automatically matched
    // Both users' status becomes MATCHED and they're removed from available pool
    const matchedUser = await this.matchingService.findMatchForUser(
      userId,
      currentUser,
      preferredCity,
      genders,
      raincheckedUserIds
    );

    if (matchedUser) {
      // findMatchForUser already creates the match, but let's verify it exists
      // This ensures the match is definitely in the database before returning the card
      try {
        const verifyMatch = await this.matchingService.getMatchForUser(userId);
        if (!verifyMatch || (verifyMatch.user1Id !== matchedUser.id && verifyMatch.user2Id !== matchedUser.id)) {
          console.warn(`[WARN] Match not found after findMatchForUser, creating it now for ${userId} and ${matchedUser.id}`);
          // This will throw if match creation fails - which is correct
          // Cards should NOT be shown if match creation fails
          await this.createMatchForCard(userId, matchedUser.id, currentUser, matchedUser);
        }
      } catch (verifyError: any) {
        console.error(`[ERROR] Failed to verify/create match:`, verifyError?.message || verifyError);
        // Don't show card if match creation fails
        throw new HttpException(
          {
            message: 'Failed to create match for card',
            error: verifyError?.message || 'Match creation failed',
            code: verifyError?.code || 'MATCH_CREATION_FAILED',
            details: verifyError?.details || verifyError?.error || verifyError,
            suggestion: 'Please check database connection and active_matches table. Check service logs for details.'
          },
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      
      const card = await this.buildCard(matchedUser, preferredCity, currentUser);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // No mutual match found, use fallback logic
    console.log(`[DEBUG] getNextCardForUser - No mutual match found, using fallback logic. preferredCity: ${preferredCity}`);
    
    // Determine statuses to filter
    const statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[] = soloOnly
      ? ["AVAILABLE"]
      : ["AVAILABLE", "IN_SQUAD_AVAILABLE", "IN_BROADCAST_AVAILABLE"];

    // Find matching users (using a fake token - won't be validated in test mode)
    console.log(`[DEBUG] getNextCardForUser - Calling findMatchingUsersForUser with city: ${preferredCity}`);
    const matchingUsers = await this.findMatchingUsersForUser(
      userId,
      preferredCity,
      statuses,
      genders,
      soloOnly,
      raincheckedUserIds
    );
    console.log(`[DEBUG] getNextCardForUser - findMatchingUsersForUser returned ${matchingUsers.length} users`);

    // If matches found, return the best match
    if (matchingUsers.length > 0) {
      console.log(`[DEBUG] getNextCardForUser - Found ${matchingUsers.length} users, selecting best match`);
      const selectedUser = await this.selectBestMatchAndCreate(userId, matchingUsers, currentUser);
      const card = await this.buildCard(selectedUser, preferredCity, currentUser);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // If no matches found and preferredCity is null, try searching in suggested cities
    if (matchingUsers.length === 0 && !preferredCity) {
      console.log(`[DEBUG] getNextCardForUser - No matches found and preferredCity is null, trying suggested cities fallback`);
      // User has no city preference - try searching in cities with available users
      const suggestedCities = await this.locationService.getCitiesWithMaxUsers(5);
      console.log(`[DEBUG] getNextCardForUser - Got ${suggestedCities.length} suggested cities:`, suggestedCities.map(c => `${c.city} (${c.availableCount})`).join(', '));
      
      for (const cityInfo of suggestedCities) {
        if (cityInfo.availableCount > 0) {
          console.log(`[DEBUG] getNextCardForUser - Trying city: ${cityInfo.city} (${cityInfo.availableCount} available)`);
          const usersInCity = await this.findMatchingUsersForUser(
            userId,
            cityInfo.city,
            statuses,
            genders,
            soloOnly,
            raincheckedUserIds
          );
          console.log(`[DEBUG] getNextCardForUser - City ${cityInfo.city} returned ${usersInCity.length} users`);
          
          if (usersInCity.length > 0) {
            console.log(`[DEBUG] getNextCardForUser - Found users in ${cityInfo.city}, creating match and card`);
            const selectedUser = await this.selectBestMatchAndCreate(userId, usersInCity, currentUser);
            const card = await this.buildCard(selectedUser, cityInfo.city, currentUser);
            
            if (hasActiveGenderFilter) {
              await this.genderFilterService.decrementScreen(userId);
            }

            return {
              card,
              exhausted: false
            };
          }
        }
      }
      console.log(`[DEBUG] getNextCardForUser - Tried all suggested cities, no users found`);
    }

    // If no matches found, check if we should show fallback
    if (matchingUsers.length === 0) {
      // If gender filter is active (screensRemaining > 0), check other cities with same gender
      if (hasActiveGenderFilter && genders && genders.length > 0) {
        // Try to find users of the same gender in other cities (anywhere)
        const usersInOtherCities = await this.findMatchingUsersForUser(
          userId,
          null, // anywhere
          statuses,
          genders, // still apply gender filter
          soloOnly,
          [] // don't exclude rainchecked for this check
        );

        // If users exist in other cities, use them (unlimited scroll)
        if (usersInOtherCities.length > 0) {
          const selectedUser = this.selectBestMatch(usersInOtherCities, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity, currentUser);
          
          if (hasActiveGenderFilter) {
            await this.genderFilterService.decrementScreen(userId);
          }

          return {
            card,
            exhausted: false
          };
        }
        
        // If no users of this gender exist anywhere, check without gender filter
        const usersWithoutGenderFilter = await this.findMatchingUsersForUser(
          userId,
          null, // anywhere
          statuses,
          undefined, // no gender filter
          soloOnly,
          [] // don't exclude rainchecked
        );

        if (usersWithoutGenderFilter.length > 0) {
          const selectedUser = this.selectBestMatch(usersWithoutGenderFilter, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity, currentUser);
          
          return {
            card,
            exhausted: false
          };
        }
      }

      // Before showing location cards, check if users are available (they might have just become available)
      // Check for users in preferred city first
      const usersBeforeLocation = preferredCity 
        ? await this.findMatchingUsersForUser(
            userId,
            preferredCity,
            statuses,
            genders,
            soloOnly,
            raincheckedUserIds
          )
        : await this.findMatchingUsersForUser(
            userId,
            null,
            statuses,
            genders,
            soloOnly,
            [] // Don't exclude rainchecked for "anywhere"
          );

      // If users are available, show them instead of location cards
      if (usersBeforeLocation.length > 0) {
        const selectedUser = this.selectBestMatch(usersBeforeLocation, currentUser);
        const card = await this.buildCard(selectedUser, preferredCity, currentUser);
        
        if (hasActiveGenderFilter) {
          await this.genderFilterService.decrementScreen(userId);
        }

        return {
          card,
          exhausted: false
        };
      }

      // No users available - show location cards (never exhausted)
      // Get location cards already shown
      const locationCardsShown = await this.getLocationCardsShown(userId, sessionId);
      
      // Get available location cards
      let locationCards = await this.getLocationCards(locationCardsShown);
      
      // If all location cards are shown, clear them and cycle through again
      if (locationCards.length === 0) {
        await this.clearLocationCards(userId, sessionId);
        locationCards = await this.getLocationCards([]);
      }
      
      // Always return a location card (never exhausted)
      if (locationCards.length > 0) {
        const selectedLocationCard = locationCards[0];
        
        // Mark as shown
        await this.markLocationCardShown(userId, sessionId, selectedLocationCard.city);
        
        return {
          card: selectedLocationCard,
          exhausted: false,
          isLocationCard: true
        };
      }
      
      // Fallback: if somehow no location cards (should never happen), return "anywhere"
      return {
        card: {
          type: "LOCATION" as const,
          city: null, // "Anywhere"
          availableCount: await this.locationService.getAnywhereUsersCount()
        },
        exhausted: false,
        isLocationCard: true
      };
    }

    // No matches found at all - return exhausted
    return {
      card: null,
      exhausted: true
    };
  }

  /**
   * Find matching users for user (test mode - bypasses auth)
   */
  private async findMatchingUsersForUser(
    userId: string,
    city: string | null,
    statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[],
    genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined,
    _soloOnly: boolean, // eslint-disable-line @typescript-eslint/no-unused-vars
    excludeUserIds: string[]
  ): Promise<DiscoveryUser[]> {
    // Add current user to exclude list
    const excludeIds = [...excludeUserIds, userId];

    // Call user service discovery endpoint directly (will need to modify to accept userId)
    // For now, we'll use the existing method but with a workaround
    const users = await this.userClient.getUsersForDiscoveryById(
      userId,
      {
        city,
        statuses,
        genders,
        excludeUserIds: excludeIds,
        limit: 500
      }
    );

    // Apply the same filtering logic as getPoolUsers
    // Filter out users who are in matchedUserIds AND have MATCHED status
    // Users with AVAILABLE status should be available even if they have old match records
    const matchedUserIds = await this.matchingService.getMatchedUserIdsCached();
    const filteredUsers = users.filter(user => {
      // Only exclude if user is in matchedUserIds AND has MATCHED status
      if (matchedUserIds.has(user.id)) {
        return user.status === 'MATCHED';
      }
      return true;
    });

    console.log(`[DEBUG] findMatchingUsersForUser - users from service: ${users.length}, after filtering: ${filteredUsers.length}`);
    return filteredUsers;
  }

  /**
   * Initialize cleanup interval for expired acceptances
   * Only cleans up expired acceptances (matches don't expire until raincheck)
   * Runs periodically to check for expired acceptances (default: every 2 seconds)
   */
  async onModuleInit() {
    // Get cleanup interval from environment (default 2 seconds)
    // Since acceptance timeout is 5 seconds, checking every 2 seconds is sufficient
    const cleanupIntervalMs = parseInt(process.env.CLEANUP_INTERVAL_MS || "2000", 10);
    
    // Clean up expired acceptances periodically
    setInterval(async () => {
      try {
        await this.matchingService.cleanupExpiredMatches();
      } catch (error) {
        console.error("[ERROR] Failed to cleanup expired matches:", error);
      }
    }, cleanupIntervalMs);
    
    console.log(`[INFO] Cleanup interval initialized: checking expired acceptances every ${cleanupIntervalMs}ms`);
  }

  /**
   * Handle room created notification from streaming-service
   * Updates all users in the room to IN_SQUAD status
   */
  async handleRoomCreated(roomId: string, userIds: string[]): Promise<void> {
    try {
      console.log(`[INFO] Room ${roomId} created with users: ${userIds.join(", ")} - updating to IN_SQUAD`);
      
      // Update all users to IN_SQUAD status
      await Promise.all(
        userIds.map((userId) => this.matchingService.updateUserStatus(userId, "IN_SQUAD"))
      );
      
      console.log(`[INFO] Successfully updated ${userIds.length} users to IN_SQUAD for room ${roomId}`);
    } catch (error: any) {
      console.error(`[ERROR] Failed to handle room created for room ${roomId}:`, error.message);
      throw error;
    }
  }

  /**
   * Handle broadcast started notification from streaming-service
   * Updates all users in the room to IN_BROADCAST status
   */
  async handleBroadcastStarted(roomId: string, userIds: string[]): Promise<void> {
    try {
      console.log(`[INFO] Broadcast started for room ${roomId} with users: ${userIds.join(", ")} - updating to IN_BROADCAST`);
      
      // Update all users to IN_BROADCAST status
      await Promise.all(
        userIds.map((userId) => this.matchingService.updateUserStatus(userId, "IN_BROADCAST"))
      );
      
      console.log(`[INFO] Successfully updated ${userIds.length} users to IN_BROADCAST for room ${roomId}`);
    } catch (error: any) {
      console.error(`[ERROR] Failed to handle broadcast started for room ${roomId}:`, error.message);
      throw error;
    }
  }

  /**
   * Handle call ended notification from streaming-service
   * Updates all users in the room to AVAILABLE status
   */
  async handleCallEnded(roomId: string, userIds: string[]): Promise<void> {
    try {
      console.log(`[INFO] Call ended for room ${roomId} with users: ${userIds.join(", ")} - updating to AVAILABLE`);
      
      // Update all users to AVAILABLE status
      await Promise.all(
        userIds.map((userId) => this.matchingService.updateUserStatus(userId, "AVAILABLE"))
      );
      
      console.log(`[INFO] Successfully updated ${userIds.length} users to AVAILABLE after call ended in room ${roomId}`);
    } catch (error: any) {
      console.error(`[ERROR] Failed to handle call ended for room ${roomId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get next OFFLINE card for user (users with ONLINE/OFFLINE/VIEWER status)
   * IMPORTANT: Does NOT create matches - this is for browsing only
   * Uses "offline-" prefix for sessionId to avoid conflicts with video call rainchecks
   */
  async getNextOfflineCard(
    token: string,
    sessionId: string,
    soloOnly: boolean = false
  ): Promise<CardResponse> {
    // Get current user profile
    const userProfileResponse = await this.userClient.getUserFullProfile(token);
    const userId = userProfileResponse.id;

    // Get user's preferred city
    const cityResponse = await this.locationService.getPreferredCity(token);
    const preferredCity = cityResponse.city;
    
    // Get viewer's actual city from location if in "anywhere" mode
    let actualCity: string | null = null;
    if (preferredCity === null && (userProfileResponse as any).latitude && (userProfileResponse as any).longitude) {
      try {
        const locationResult = await this.locationService.locateMe(
          (userProfileResponse as any).latitude,
          (userProfileResponse as any).longitude
        );
        actualCity = locationResult.city;
      } catch (error) {
        console.warn("Failed to get actual city from location:", error);
      }
    }
    
    // Convert to UserProfile interface
    const currentUser: UserProfile = {
      id: userProfileResponse.id,
      preferredCity: preferredCity,
      brandPreferences: (userProfileResponse as any).brandPreferences,
      interests: (userProfileResponse as any).interests,
      values: (userProfileResponse as any).values,
      musicPreference: (userProfileResponse as any).musicPreference,
      videoEnabled: (userProfileResponse as any).videoEnabled,
      actualCity: actualCity
    };

    // Get gender filter preference
    const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
    const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;

    // Determine gender filter - ONLY apply when screensRemaining > 0
    let genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined;
    if (hasActiveGenderFilter) {
      const gendersJson = genderFilter.genders;
      if (typeof gendersJson === "string") {
        genders = JSON.parse(gendersJson);
      } else if (Array.isArray(gendersJson)) {
        genders = gendersJson as ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      }
    }

    // Use prefixed sessionId to avoid conflicts with video call rainchecks
    const offlineSessionId = `offline-${sessionId}`;

    // Get rainchecked user IDs for this OFFLINE session and city
    const raincheckedUserIds = await this.getOfflineRaincheckedUserIds(userId, offlineSessionId, preferredCity);

    // Determine statuses to filter - OFFLINE cards show ONLINE, OFFLINE, VIEWER
    const statuses: ("ONLINE" | "OFFLINE" | "VIEWER")[] = ["ONLINE", "OFFLINE", "VIEWER"];

    // Find matching users (same scoring system, but no match creation)
    const matchingUsers = await this.findOfflineMatchingUsers(
      token,
      userId,
      preferredCity,
      statuses,
      genders,
      soloOnly,
      raincheckedUserIds
    );

    // If matches found, return the best match (using same scoring)
    if (matchingUsers.length > 0) {
      const selectedUser = this.selectBestMatch(matchingUsers, currentUser);
      const card = await this.buildCard(selectedUser, preferredCity, currentUser);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // No matches found - return exhausted
    return {
      card: null,
      exhausted: true
    };
  }

  /**
   * Find matching users for OFFLINE cards (ONLINE/OFFLINE/VIEWER statuses)
   */
  private async findOfflineMatchingUsers(
    token: string,
    userId: string,
    city: string | null,
    statuses: ("ONLINE" | "OFFLINE" | "VIEWER")[],
    genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined,
    _soloOnly: boolean,
    excludeUserIds: string[]
  ): Promise<DiscoveryUser[]> {
    // Add current user to exclude list
    const excludeIds = [...excludeUserIds, userId];

    const users = await this.userClient.getUsersForDiscovery(token, {
      city,
      statuses: statuses as ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE" | "ONLINE" | "OFFLINE" | "VIEWER" | "MATCHED")[],
      genders,
      excludeUserIds: excludeIds,
      limit: 500 // Get a large pool
    });

    return users;
  }

  /**
   * Get rainchecked user IDs for OFFLINE cards session (uses prefixed sessionId)
   */
  private async getOfflineRaincheckedUserIds(
    userId: string,
    offlineSessionId: string,
    city: string | null
  ): Promise<string[]> {
    try {
      const rainchecks = await (this.prisma as any).raincheckSession.findMany({
        where: {
          userId,
          sessionId: offlineSessionId, // Uses "offline-" prefixed sessionId
          city: city || null,
          raincheckedUserId: {
            not: {
              startsWith: "LOCATION:"
            }
          }
        },
        select: {
          raincheckedUserId: true
        }
      });

      return rainchecks.map((r: { raincheckedUserId: string }) => r.raincheckedUserId);
    } catch (error: any) {
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("Raincheck table not found, returning empty array:", error.message);
        return [];
      }
      console.error("Error fetching OFFLINE rainchecked users:", error);
      return [];
    }
  }

  /**
   * Mark user as rainchecked in OFFLINE cards (uses prefixed sessionId)
   * IMPORTANT: Does NOT create or remove matches - this is for browsing only
   */
  async markOfflineRaincheck(
    userId: string,
    sessionId: string,
    raincheckedUserId: string,
    city: string | null
  ): Promise<void> {
    try {
      // Use prefixed sessionId to avoid conflicts with video call rainchecks
      const offlineSessionId = `offline-${sessionId}`;

      // IMPORTANT: Do NOT check for matches or reset statuses - OFFLINE cards don't create matches
      // Just mark as rainchecked in session (bidirectionally - both users should exclude each other)
      const existing1 = await (this.prisma as any).raincheckSession.findFirst({
        where: {
          userId,
          sessionId: offlineSessionId,
          raincheckedUserId,
          city: city || null
        }
      });

      if (!existing1) {
        await (this.prisma as any).raincheckSession.create({
          data: {
            userId,
            sessionId: offlineSessionId,
            raincheckedUserId,
            city: city || null
          }
        });
      }

      // Also record the reverse raincheck (User B should also exclude User A)
      const existing2 = await (this.prisma as any).raincheckSession.findFirst({
        where: {
          userId: raincheckedUserId,
          sessionId: offlineSessionId,
          raincheckedUserId: userId,
          city: city || null
        }
      });

      if (!existing2) {
        await (this.prisma as any).raincheckSession.create({
          data: {
            userId: raincheckedUserId,
            sessionId: offlineSessionId,
            raincheckedUserId: userId,
            city: city || null
          }
        });
      }

      console.log(`[INFO] OFFLINE card raincheck recorded: ${userId} rainchecked ${raincheckedUserId} (session: ${offlineSessionId})`);
    } catch (error: any) {
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("Raincheck table not found, skipping OFFLINE raincheck:", error.message);
        return;
      }
      throw error;
    }
  }

  /**
   * Get next OFFLINE card for user (test mode - bypasses auth)
   */
  async getNextOfflineCardForUser(
    userId: string,
    sessionId: string,
    soloOnly: boolean = false
  ): Promise<CardResponse> {
    // Get current user profile directly by userId
    const userProfileResponse = await this.userClient.getUserFullProfileById(userId);
    
    // Get user's preferred city directly
    const preferredCity = await this.userClient.getPreferredCityById(userId);
    
    // Get viewer's actual city from location if in "anywhere" mode
    let actualCity: string | null = null;
    if (preferredCity === null && (userProfileResponse as any).latitude && (userProfileResponse as any).longitude) {
      try {
        const locationResult = await this.locationService.locateMe(
          (userProfileResponse as any).latitude,
          (userProfileResponse as any).longitude
        );
        actualCity = locationResult.city;
      } catch (error) {
        console.warn("Failed to get actual city from location:", error);
      }
    }
    
    // Convert to UserProfile interface
    const currentUser: UserProfile = {
      id: userProfileResponse.id,
      preferredCity: preferredCity,
      brandPreferences: (userProfileResponse as any).brandPreferences,
      interests: (userProfileResponse as any).interests,
      values: (userProfileResponse as any).values,
      musicPreference: (userProfileResponse as any).musicPreference,
      videoEnabled: (userProfileResponse as any).videoEnabled,
      actualCity: actualCity
    };

    // Get gender filter preference
    const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
    const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;

    // Determine gender filter
    let genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined;
    if (hasActiveGenderFilter) {
      const gendersJson = genderFilter.genders;
      if (typeof gendersJson === "string") {
        genders = JSON.parse(gendersJson);
      } else if (Array.isArray(gendersJson)) {
        genders = gendersJson as ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[];
      }
    }

    // Use prefixed sessionId to avoid conflicts
    const offlineSessionId = `offline-${sessionId}`;

    // Get rainchecked user IDs for this OFFLINE session
    const raincheckedUserIds = await this.getOfflineRaincheckedUserIds(userId, offlineSessionId, preferredCity);

    // Determine statuses - OFFLINE cards show ONLINE, OFFLINE, VIEWER
    const statuses: ("ONLINE" | "OFFLINE" | "VIEWER")[] = ["ONLINE", "OFFLINE", "VIEWER"];

    // Find matching users (no match creation)
    const matchingUsers = await this.findOfflineMatchingUsersForUser(
      userId,
      preferredCity,
      statuses,
      genders,
      soloOnly,
      raincheckedUserIds
    );

    // If matches found, return the best match
    if (matchingUsers.length > 0) {
      const selectedUser = this.selectBestMatch(matchingUsers, currentUser);
      const card = await this.buildCard(selectedUser, preferredCity, currentUser);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // No matches found - return exhausted
    return {
      card: null,
      exhausted: true
    };
  }

  /**
   * Find matching users for OFFLINE cards (test mode - bypasses auth)
   */
  private async findOfflineMatchingUsersForUser(
    userId: string,
    city: string | null,
    statuses: ("ONLINE" | "OFFLINE" | "VIEWER")[],
    genders: ("MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY")[] | undefined,
    _soloOnly: boolean,
    excludeUserIds: string[]
  ): Promise<DiscoveryUser[]> {
    // Add current user to exclude list
    const excludeIds = [...excludeUserIds, userId];

    const users = await this.userClient.getUsersForDiscoveryById(
      userId,
      {
        city,
        statuses: statuses as ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE" | "ONLINE" | "OFFLINE" | "VIEWER" | "MATCHED")[],
        genders,
        excludeUserIds: excludeIds,
        limit: 500
      }
    );

    // Filter out users who are matched (they shouldn't appear in OFFLINE cards)
    const matchedUserIds = await this.matchingService.getMatchedUserIdsCached();
    const filteredUsers = users.filter(user => {
      // Exclude if user is in matchedUserIds AND has MATCHED status
      if (matchedUserIds.has(user.id)) {
        return user.status === 'MATCHED';
      }
      return true;
    });

    console.log(`[DEBUG] findOfflineMatchingUsersForUser - users from service: ${users.length}, after filtering: ${filteredUsers.length}`);
    return filteredUsers;
  }

  /**
   * Get next broadcast in HMM_TV feed (for scrolling like TikTok/Reels)
   * Uses session tracking to avoid showing the same broadcast twice
   */
  async getNextBroadcast(
    token: string,
    sessionId: string
  ): Promise<{
    broadcast: {
      roomId: string;
      participantCount: number;
      viewerCount: number;
      participants: Array<{
        userId: string;
        role: string;
        joinedAt: Date;
      }>;
      startedAt: Date | null;
      createdAt: Date;
    } | null;
    exhausted: boolean;
  }> {
    // Get current user profile
    const userProfileResponse = await this.userClient.getUserFullProfile(token);
    const userId = userProfileResponse.id;

    // Get all active broadcasts
    const broadcasts = await this.streamingClient.getActiveBroadcasts();

    if (broadcasts.length === 0) {
      return {
        broadcast: null,
        exhausted: true
      };
    }

    // Get viewed broadcast roomIds for this session
    const viewedRoomIds = await this.getViewedBroadcastRoomIds(userId, sessionId);

    // Filter out viewed broadcasts
    const availableBroadcasts = broadcasts.filter(
      b => !viewedRoomIds.includes(b.roomId)
    );

    if (availableBroadcasts.length === 0) {
      // All broadcasts have been viewed - return exhausted
      return {
        broadcast: null,
        exhausted: true
      };
    }

    // Return the first available broadcast (most recent)
    const nextBroadcast = availableBroadcasts[0];

    return {
      broadcast: nextBroadcast,
      exhausted: false
    };
  }

  /**
   * Mark a broadcast as viewed (for session tracking)
   * Uses BroadcastViewHistory table instead of RaincheckSession hack
   */
  async markBroadcastViewed(
    userId: string,
    sessionId: string,
    roomId: string,
    duration?: number,
    deviceId?: string
  ): Promise<void> {
    try {
      // Use BroadcastViewHistory table (new approach)
      await (this.prisma as any).broadcastViewHistory.create({
        data: {
          userId,
          roomId,
          duration,
          deviceId
        }
      });
    } catch (error: any) {
      // If BroadcastViewHistory doesn't exist, fallback to RaincheckSession
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("BroadcastViewHistory table not found, falling back to RaincheckSession:", error.message);
        // Fallback to old method
        const broadcastRoomId = `BROADCAST:${roomId}`;
        const existing = await (this.prisma as any).raincheckSession.findFirst({
          where: {
            userId,
            sessionId,
            raincheckedUserId: broadcastRoomId
          }
        });

        if (!existing) {
          await (this.prisma as any).raincheckSession.create({
            data: {
              userId,
              sessionId,
              raincheckedUserId: broadcastRoomId,
              city: null
            }
          });
        }
        return;
      }
      console.error("Error marking broadcast as viewed:", error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Get viewed broadcast roomIds for current session
   * Uses BroadcastViewHistory table instead of RaincheckSession hack
   */
  private async getViewedBroadcastRoomIds(
    userId: string,
    sessionId: string
  ): Promise<string[]> {
    try {
      // Try BroadcastViewHistory first (new table)
      const views = await (this.prisma as any).broadcastViewHistory.findMany({
        where: {
          userId
          // Optionally filter by deviceId for cross-device sync
          // deviceId: deviceId
        },
        select: {
          roomId: true
        },
        distinct: ['roomId']
      });

      if (views.length > 0) {
        return views.map((v: { roomId: string }) => v.roomId);
      }

      // Fallback to RaincheckSession for backward compatibility
      // This can be removed after migration
      const rainchecks = await (this.prisma as any).raincheckSession.findMany({
        where: {
          userId,
          sessionId,
          raincheckedUserId: {
            startsWith: "BROADCAST:"
          }
        },
        select: {
          raincheckedUserId: true
        }
      });

      return rainchecks.map((r: { raincheckedUserId: string }) => 
        r.raincheckedUserId.replace("BROADCAST:", "")
      );
    } catch (error: any) {
      // If table doesn't exist or other Prisma error, return empty array
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("BroadcastViewHistory table not found, falling back to RaincheckSession:", error.message);
        // Fallback to RaincheckSession
        try {
          const rainchecks = await (this.prisma as any).raincheckSession.findMany({
            where: {
              userId,
              sessionId,
              raincheckedUserId: {
                startsWith: "BROADCAST:"
              }
            },
            select: {
              raincheckedUserId: true
            }
          });
          return rainchecks.map((r: { raincheckedUserId: string }) => 
            r.raincheckedUserId.replace("BROADCAST:", "")
          );
        } catch (fallbackError) {
          console.warn("RaincheckSession fallback also failed:", fallbackError);
          return [];
        }
      }
      console.error("Error fetching viewed broadcasts:", error);
      return [];
    }
  }

  /**
   * Get next broadcast in feed (test endpoint - bypasses auth)
   */
  async getNextBroadcastForUser(
    userId: string,
    sessionId: string
  ): Promise<{
    broadcast: {
      roomId: string;
      participantCount: number;
      viewerCount: number;
      participants: Array<{
        userId: string;
        role: string;
        joinedAt: Date;
      }>;
      startedAt: Date | null;
      createdAt: Date;
    } | null;
    exhausted: boolean;
  }> {
    // Get all active broadcasts
    const broadcasts = await this.streamingClient.getActiveBroadcasts();

    if (broadcasts.length === 0) {
      return {
        broadcast: null,
        exhausted: true
      };
    }

    // Get viewed broadcast roomIds for this session
    const viewedRoomIds = await this.getViewedBroadcastRoomIds(userId, sessionId);

    // Filter out viewed broadcasts
    let availableBroadcasts = broadcasts.filter(
      b => !viewedRoomIds.includes(b.roomId)
    );

    if (availableBroadcasts.length === 0) {
      // All broadcasts have been viewed - return exhausted
      return {
        broadcast: null,
        exhausted: true
      };
    }

    // Apply recommendation algorithm for personalized feed
    const recommendedBroadcast = await this.getRecommendedBroadcast(userId, availableBroadcasts);

    return {
      broadcast: recommendedBroadcast,
      exhausted: false
    };
  }

  /**
   * Get recommended broadcast based on user preferences and viewing history
   * Considers: interests, location, gender preferences, engagement patterns, trending
   */
  private async getRecommendedBroadcast(
    userId: string,
    availableBroadcasts: Array<{
      roomId: string;
      participantCount: number;
      viewerCount: number;
      participants: Array<{
        userId: string;
        role: string;
        joinedAt: Date;
      }>;
      startedAt: Date | null;
      createdAt: Date;
      broadcastTitle?: string | null;
      broadcastDescription?: string | null;
      broadcastTags?: string[];
      isTrending?: boolean;
      popularityScore?: number;
    }>
  ): Promise<{
    roomId: string;
    participantCount: number;
    viewerCount: number;
    participants: Array<{
      userId: string;
      role: string;
      joinedAt: Date;
    }>;
    startedAt: Date | null;
    createdAt: Date;
  }> {
    try {
      // Get user profile for preferences
      const userProfile = await this.userClient.getUserProfileById(userId).catch(() => null);
      
      // Score each broadcast
      const scoredBroadcasts = await Promise.all(
        availableBroadcasts.map(async (broadcast) => {
          let score = 0;

          // 1. Trending boost (high priority)
          if (broadcast.isTrending) {
            score += 50;
          }

          // 2. Popularity score (normalized)
          if (broadcast.popularityScore) {
            score += Math.min(broadcast.popularityScore / 10, 30); // Cap at 30 points
          }

          // 3. Viewer count (engagement indicator)
          score += Math.min(broadcast.viewerCount / 5, 20); // Cap at 20 points

          // 4. Recency (recent broadcasts get boost)
          if (broadcast.startedAt) {
            const hoursSinceStart = (Date.now() - new Date(broadcast.startedAt).getTime()) / (1000 * 60 * 60);
            if (hoursSinceStart < 1) {
              score += 15; // Very recent
            } else if (hoursSinceStart < 6) {
              score += 10; // Recent
            } else if (hoursSinceStart < 24) {
              score += 5; // Today
            }
          }

          // 5. Tags/interests matching (if user profile available)
          if (userProfile && broadcast.broadcastTags && broadcast.broadcastTags.length > 0) {
            const userInterests = userProfile.interests?.map(i => i.interest?.name?.toLowerCase()) || [];
            const matchingTags = broadcast.broadcastTags.filter(tag => 
              userInterests.some(interest => interest.includes(tag.toLowerCase()) || tag.toLowerCase().includes(interest))
            );
            score += matchingTags.length * 5; // 5 points per matching tag
          }

          return { broadcast, score };
        })
      );

      // Sort by score (descending) and return top broadcast
      scoredBroadcasts.sort((a, b) => b.score - a.score);
      return scoredBroadcasts[0].broadcast;
    } catch (error: any) {
      // If recommendation fails, fall back to most recent
      console.error("Error in recommendation algorithm:", error);
      return availableBroadcasts[0];
    }
  }

  /**
   * Add a comment to a broadcast
   */
  async addBroadcastComment(
    roomId: string,
    userId: string,
    comment: string
  ): Promise<{
    id: string;
    roomId: string;
    userId: string;
    comment: string;
    createdAt: Date;
  }> {
    try {
      const newComment = await (this.prisma as any).broadcastComment.create({
        data: {
          roomId,
          userId,
          comment: comment.trim()
        }
      });

      // Update popularity score
      await this.updateBroadcastPopularityScore(roomId);

      return {
        id: newComment.id,
        roomId: newComment.roomId,
        userId: newComment.userId,
        comment: newComment.comment,
        createdAt: newComment.createdAt
      };
    } catch (error: any) {
      console.error("Error adding broadcast comment:", error);
      throw new HttpException("Failed to add comment", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get comments for a broadcast
   */
  async getBroadcastComments(
    roomId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    comments: Array<{
      id: string;
      userId: string;
      comment: string;
      createdAt: Date;
    }>;
    total: number;
  }> {
    try {
      const [comments, total] = await Promise.all([
        (this.prisma as any).broadcastComment.findMany({
          where: {
            roomId,
            deletedAt: null
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: limit,
          skip: offset,
          select: {
            id: true,
            userId: true,
            comment: true,
            createdAt: true
          }
        }),
        (this.prisma as any).broadcastComment.count({
          where: {
            roomId,
            deletedAt: null
          }
        })
      ]);

      return {
        comments,
        total
      };
    } catch (error: any) {
      console.error("Error getting broadcast comments:", error);
      throw new HttpException("Failed to get comments", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Share a broadcast
   */
  async shareBroadcast(
    roomId: string,
    userId: string,
    shareType: string = "link"
  ): Promise<{
    id: string;
    roomId: string;
    userId: string;
    shareType: string;
    shareableUrl: string;
    createdAt: Date;
  }> {
    try {
      const share = await (this.prisma as any).broadcastShare.create({
        data: {
          roomId,
          userId,
          shareType
        }
      });

      // Generate shareable URL
      const baseUrl = process.env.APP_URL || "https://app.hmmchat.live";
      const shareableUrl = `${baseUrl}/broadcast/${roomId}`;

      // Update popularity score
      await this.updateBroadcastPopularityScore(roomId);

      return {
        id: share.id,
        roomId: share.roomId,
        userId: share.userId,
        shareType: share.shareType,
        shareableUrl,
        createdAt: share.createdAt
      };
    } catch (error: any) {
      console.error("Error sharing broadcast:", error);
      throw new HttpException("Failed to share broadcast", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get broadcast details by roomId (for deep linking)
   */
  async getBroadcastByRoomId(roomId: string): Promise<{
    roomId: string;
    participantCount: number;
    viewerCount: number;
    participants: Array<{
      userId: string;
      role: string;
      joinedAt: Date;
      username?: string | null;
      displayPictureUrl?: string | null;
      age?: number | null;
    }>;
    startedAt: Date | null;
    createdAt: Date;
    broadcastTitle?: string | null;
    broadcastDescription?: string | null;
    broadcastTags?: string[];
    isTrending?: boolean;
    popularityScore?: number;
    commentCount: number;
    shareCount: number;
    exists: boolean;
    isActive: boolean;
  } | null> {
    try {
      // Get all active broadcasts and find the one matching roomId
      const broadcasts = await this.streamingClient.getActiveBroadcasts();
      const broadcast = broadcasts.find((b: any) => b.roomId === roomId);

      if (!broadcast) {
        // Broadcast not found or not active
        return null;
      }

      // Get engagement metrics
      const [commentCount, shareCount] = await Promise.all([
        (this.prisma as any).broadcastComment.count({ where: { roomId, deletedAt: null } }),
        (this.prisma as any).broadcastShare.count({ where: { roomId } })
      ]);

      // Get participant profiles (if not already included)
      const participantUserIds = broadcast.participants?.map((p: any) => p.userId) || [];
      const participantProfiles = new Map<string, { username: string | null; displayPictureUrl: string | null; age: number | null }>();
      
      // Only fetch profiles if they're not already included in the broadcast data
      const needsProfileFetch = broadcast.participants?.some((p: any) => !p.username);
      if (needsProfileFetch && participantUserIds.length > 0) {
        try {
          // Fetch profiles in parallel
          const profilePromises = participantUserIds.map(async (userId: string) => {
            try {
              const profile = await this.userClient.getUserFullProfileById(userId);
              return { userId, profile };
            } catch (error) {
              console.warn(`Failed to fetch profile for user ${userId}: ${error}`);
              return { userId, profile: null };
            }
          });
          const profileResults = await Promise.all(profilePromises);
          profileResults.forEach(({ userId, profile }) => {
            if (profile) {
              const age = profile.dateOfBirth 
                ? Math.floor((Date.now() - new Date(profile.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                : null;
              participantProfiles.set(userId, {
                username: profile.username,
                displayPictureUrl: profile.displayPictureUrl,
                age
              });
            }
          });
        } catch (error) {
          console.warn(`Failed to fetch participant profiles: ${error}`);
        }
      }

      // Get additional metadata from database if not in broadcast
      const session = await (this.prisma as any).callSession.findUnique({
        where: { roomId },
        select: { 
          popularityScore: true,
          isTrending: true,
          broadcastTitle: true,
          broadcastDescription: true,
          broadcastTags: true
        }
      });

      return {
        roomId: broadcast.roomId,
        participantCount: broadcast.participantCount || 0,
        viewerCount: broadcast.viewerCount || 0,
        participants: (broadcast.participants || []).map((p: any) => {
          // Use existing profile data if available, otherwise fetch
          if (p.username !== undefined) {
            return {
              userId: p.userId,
              role: p.role,
              joinedAt: p.joinedAt,
              username: p.username || null,
              displayPictureUrl: p.displayPictureUrl || null,
              age: p.age || null
            };
          }
          const profile = participantProfiles.get(p.userId);
          return {
            userId: p.userId,
            role: p.role,
            joinedAt: p.joinedAt,
            username: profile?.username || null,
            displayPictureUrl: profile?.displayPictureUrl || null,
            age: profile?.age || null
          };
        }),
        startedAt: broadcast.startedAt,
        createdAt: broadcast.createdAt,
        broadcastTitle: (broadcast as any).broadcastTitle || session?.broadcastTitle || null,
        broadcastDescription: (broadcast as any).broadcastDescription || session?.broadcastDescription || null,
        broadcastTags: (broadcast as any).broadcastTags || session?.broadcastTags || [],
        isTrending: (broadcast as any).isTrending !== undefined ? (broadcast as any).isTrending : (session?.isTrending || false),
        popularityScore: (broadcast as any).popularityScore !== undefined ? (broadcast as any).popularityScore : (session?.popularityScore || 0),
        commentCount,
        shareCount,
        exists: true,
        isActive: true
      };
    } catch (error: any) {
      console.error("Error getting broadcast by roomId:", error);
      throw new HttpException("Failed to get broadcast", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Send gift to broadcast participants (via streaming service)
   */
  async sendBroadcastGift(
    roomId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
    giftId: string
  ): Promise<{
    success: boolean;
    transactionId?: string;
    newBalance?: number;
  }> {
    try {
      // Call streaming service to send gift
      const result = await this.streamingClient.sendGift(roomId, fromUserId, toUserId, amount, giftId);
      return result;
    } catch (error: any) {
      console.error("Error sending broadcast gift:", error);
      throw new HttpException("Failed to send gift", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Update popularity score for a broadcast
   * Calculates based on: viewer count, comments, shares, recency
   */
  private async updateBroadcastPopularityScore(roomId: string): Promise<void> {
    try {
      // Get engagement metrics
      const [commentCount, shareCount] = await Promise.all([
        (this.prisma as any).broadcastComment.count({ where: { roomId, deletedAt: null } }),
        (this.prisma as any).broadcastShare.count({ where: { roomId } })
      ]);

      // Get viewer count from streaming service
      const broadcasts = await this.streamingClient.getActiveBroadcasts();
      const broadcast = broadcasts.find((b: any) => b.roomId === roomId);
      const viewerCount = broadcast?.viewerCount || 0;

      // Calculate popularity score
      // Formula: (viewers * 1) + (comments * 3) + (shares * 5) + recency bonus
      const baseScore = viewerCount * 1 + commentCount * 3 + shareCount * 5;

      // Recency bonus: broadcasts started in last hour get bonus
      const session = await (this.prisma as any).callSession.findUnique({
        where: { roomId },
        select: { startedAt: true, createdAt: true }
      });

      let recencyBonus = 0;
      if (session?.startedAt) {
        const hoursSinceStart = (Date.now() - new Date(session.startedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceStart < 1) {
          recencyBonus = 10; // Bonus for broadcasts less than 1 hour old
        } else if (hoursSinceStart < 6) {
          recencyBonus = 5; // Smaller bonus for broadcasts less than 6 hours old
        }
      }

      const popularityScore = baseScore + recencyBonus;

      // Update in streaming service database
      await (this.prisma as any).callSession.update({
        where: { roomId },
        data: { popularityScore }
      });

      // Check if should be marked as trending
      await this.updateTrendingStatus(roomId, popularityScore, viewerCount);
    } catch (error: any) {
      console.error("Error updating popularity score:", error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Update trending status for a broadcast
   * Trending = high popularity score + recent spike in viewers/engagement
   */
  private async updateTrendingStatus(
    roomId: string,
    popularityScore: number,
    viewerCount: number
  ): Promise<void> {
    try {
      // Trending criteria:
      // - Popularity score > 50
      // - Viewer count > 10
      const isTrending = popularityScore > 50 && viewerCount > 10;

      await (this.prisma as any).callSession.update({
        where: { roomId },
        data: { isTrending }
      });
    } catch (error: any) {
      console.error("Error updating trending status:", error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Follow a broadcast participant
   * A viewer can follow individual participants in a broadcast
   */
  async followBroadcastParticipant(
    followerId: string,
    followedUserId: string,
    roomId: string
  ): Promise<{ success: boolean; followId: string }> {
    try {
      // Validate that the roomId is an active broadcast
      const broadcasts = await this.streamingClient.getActiveBroadcasts();
      const broadcast = broadcasts.find((b: any) => b.roomId === roomId);

      if (!broadcast) {
        throw new HttpException("Broadcast not found or not active", HttpStatus.NOT_FOUND);
      }

      // Validate that followedUserId is a participant in the broadcast
      const participantIds = (broadcast.participants || []).map((p: any) => p.userId);
      if (!participantIds.includes(followedUserId)) {
        throw new HttpException(
          "User is not a participant in this broadcast",
          HttpStatus.BAD_REQUEST
        );
      }

      // Prevent self-follow
      if (followerId === followedUserId) {
        throw new HttpException("Cannot follow yourself", HttpStatus.BAD_REQUEST);
      }

      // Check if already following
      const existingFollow = await (this.prisma as any).broadcastFollow.findFirst({
        where: {
          followerId,
          followedUserId,
          roomId
        }
      });

      if (existingFollow) {
        throw new HttpException("Already following this user in this broadcast", HttpStatus.BAD_REQUEST);
      }

      // Create follow relationship
      const follow = await (this.prisma as any).broadcastFollow.create({
        data: {
          followerId,
          followedUserId,
          roomId
        }
      });

      return {
        success: true,
        followId: follow.id
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error("Error following broadcast participant:", error);
      throw new HttpException("Failed to follow user", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Unfollow a broadcast participant
   */
  async unfollowBroadcastParticipant(
    followerId: string,
    followedUserId: string,
    roomId: string
  ): Promise<{ success: boolean }> {
    try {
      // Find and delete the follow relationship
      const follow = await (this.prisma as any).broadcastFollow.findFirst({
        where: {
          followerId,
          followedUserId,
          roomId
        }
      });

      if (!follow) {
        throw new HttpException("Follow relationship not found", HttpStatus.NOT_FOUND);
      }

      await (this.prisma as any).broadcastFollow.delete({
        where: {
          id: follow.id
        }
      });

      return { success: true };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error("Error unfollowing broadcast participant:", error);
      throw new HttpException("Failed to unfollow user", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get all users followed by a viewer in broadcasts
   * This can be used later for the "sent request section"
   */
  async getFollowedBroadcastParticipants(followerId: string): Promise<Array<{
    followId: string;
    followedUserId: string;
    roomId: string;
    createdAt: Date;
  }>> {
    try {
      const follows = await (this.prisma as any).broadcastFollow.findMany({
        where: {
          followerId
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return follows.map((follow: any) => ({
        followId: follow.id,
        followedUserId: follow.followedUserId,
        roomId: follow.roomId,
        createdAt: follow.createdAt
      }));
    } catch (error: any) {
      console.error("Error getting followed broadcast participants:", error);
      throw new HttpException("Failed to get followed users", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Check if a user is following another user in a specific broadcast
   */
  async isFollowingBroadcastParticipant(
    followerId: string,
    followedUserId: string,
    roomId: string
  ): Promise<boolean> {
    try {
      const follow = await (this.prisma as any).broadcastFollow.findFirst({
        where: {
          followerId,
          followedUserId,
          roomId
        }
      });

      return !!follow;
    } catch (error: any) {
      console.error("Error checking follow status:", error);
      return false;
    }
  }
}

