import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserClientService } from "./user-client.service.js";
import { GenderFilterService } from "./gender-filter.service.js";
import { LocationService } from "./location.service.js";
import { MatchingService } from "./matching.service.js";

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
  status: "AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE";
  reported?: boolean;
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
    private readonly matchingService: MatchingService
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
      const card = await this.buildCard(this.convertToDiscoveryUser(matchedUser), preferredCity);
      
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
      const card = await this.buildCard(matchedUser, preferredCity);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // No match found, check fallback options
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
          const card = await this.buildCard(selectedUser, preferredCity);
          
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
          const card = await this.buildCard(selectedUser, preferredCity);
          
          return {
            card,
            exhausted: false
          };
        }
      }

      // If user has a city preference and it's exhausted, show location cards
      if (preferredCity) {
        // Get location cards already shown
        const locationCardsShown = await this.getLocationCardsShown(userId, sessionId);
        
        // Get available location cards
        const locationCards = await this.getLocationCards(locationCardsShown);
        
        // If there are location cards available, return one
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
        
        // All location cards exhausted - reset session and show user cards again
        await this.resetSession(userId, sessionId, preferredCity);
        
        // Try to get users again (now with reset session)
        const usersAfterReset = await this.findMatchingUsers(
          token,
          userId,
          preferredCity,
          statuses,
          genders,
          soloOnly,
          [] // Session reset, so no rainchecked users
        );
        
        if (usersAfterReset.length > 0) {
          const selectedUser = this.selectBestMatch(usersAfterReset, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity);
          
          if (hasActiveGenderFilter) {
            await this.genderFilterService.decrementScreen(userId);
          }

          return {
            card,
            exhausted: false
          };
        }
      } else {
        // If anywhere and exhausted, show rainchecked again (unlimited scroll)
        const allUsers = await this.findMatchingUsers(
          token,
          userId,
          null,
          statuses,
          genders, // only applies if hasActiveGenderFilter is true
          soloOnly,
          [] // Don't exclude rainchecked - this allows cycling through same users
        );

        if (allUsers.length === 0) {
          // Only truly exhausted if there are 0 users in entire database
          // This should be extremely rare
          const suggestedCities = await this.locationService.getCitiesWithMaxUsers(10);
          return {
            card: null,
            exhausted: true,
            suggestedCities: suggestedCities.map((c) => ({
              city: c.city,
              availableCount: c.availableCount
            }))
          };
        }

        // Return a rainchecked user (unlimited scroll - cycles through same users)
        const selectedUser = this.selectBestMatch(allUsers, currentUser);
        const card = await this.buildCard(selectedUser, preferredCity);
        
        // Decrement gender filter screens only if still active
        if (hasActiveGenderFilter) {
          await this.genderFilterService.decrementScreen(userId);
        }

        return {
          card,
          exhausted: false
        };
      }
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
   * Build card response from user data
   */
  private async buildCard(user: DiscoveryUser, _currentCity: string | null): Promise<Card> {
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
      status: user.status as "AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE",
      reported: isReported
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
    
    // Filter out excluded cities
    const availableCities = allCities.filter(
      c => !excludeCities.includes(c.city)
    );
    
    // Randomly select 8-10 cities
    const count = Math.min(8 + Math.floor(Math.random() * 3), availableCities.length); // 8-10 cities
    const shuffled = [...availableCities].sort(() => Math.random() - 0.5);
    const selectedCities = shuffled.slice(0, count);
    
    // Add "Anywhere" option with calculated total
    const locationCards: LocationCard[] = [
      ...selectedCities.map(c => ({
        type: "LOCATION" as const,
        city: c.city,
        availableCount: c.availableCount
      })),
      {
        type: "LOCATION" as const,
        city: null, // "Anywhere"
        availableCount: anywhereCount // Users with null city + all users from all cities
      }
    ];
    
    // Shuffle again to randomize "Anywhere" position
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

      // Small delay to ensure status updates are committed
      await new Promise(resolve => setTimeout(resolve, 100));

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
  async proceedWithMatch(userId: string, matchedUserId: string): Promise<void> {
    // Verify that users are actually matched
    const match = await this.matchingService.getMatchForUser(userId);
    if (!match || (match.user1Id !== matchedUserId && match.user2Id !== matchedUserId)) {
      throw new HttpException("Users are not matched", HttpStatus.BAD_REQUEST);
    }

    // Get acceptance timeout from environment (default 5 seconds)
    // This is the timeout after one user accepts - wait 5 seconds for the other to accept
    const acceptanceTimeoutSeconds = parseInt(process.env.MATCH_ACCEPTANCE_TIMEOUT_SECONDS || "5", 10);

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
      
      // Update both users' status to IN_SQUAD
      await this.matchingService.updateUserStatus(match.user1Id, "IN_SQUAD");
      await this.matchingService.updateUserStatus(match.user2Id, "IN_SQUAD");
      
      console.log(`[INFO] Both users accepted match - ${match.user1Id} and ${match.user2Id} moved to IN_SQUAD`);
    } else {
      // Only one user has accepted - wait for the other user
      console.log(`[INFO] User ${userId} accepted match, waiting for ${matchedUserId} to accept`);
      // The match will expire if the other user doesn't accept within the timeout
      // Cleanup will be handled by the cleanupExpiredMatches function
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
      const card = await this.buildCard(this.convertToDiscoveryUser(matchedUser), preferredCity);
      
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
      const card = await this.buildCard(matchedUser, preferredCity);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
    }

    // No mutual match found, use fallback logic
    // Determine statuses to filter
    const statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[] = soloOnly
      ? ["AVAILABLE"]
      : ["AVAILABLE", "IN_SQUAD_AVAILABLE", "IN_BROADCAST_AVAILABLE"];

    // Find matching users (using a fake token - won't be validated in test mode)
    const matchingUsers = await this.findMatchingUsersForUser(
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
      const card = await this.buildCard(selectedUser, preferredCity);
      
      if (hasActiveGenderFilter) {
        await this.genderFilterService.decrementScreen(userId);
      }

      return {
        card,
        exhausted: false
      };
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
          const card = await this.buildCard(selectedUser, preferredCity);
          
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
          const card = await this.buildCard(selectedUser, preferredCity);
          
          return {
            card,
            exhausted: false
          };
        }
      }

      // If user has a city preference and it's exhausted, show location cards
      if (preferredCity) {
        // Get location cards already shown
        const locationCardsShown = await this.getLocationCardsShown(userId, sessionId);
        
        // Get available location cards
        const locationCards = await this.getLocationCards(locationCardsShown);
        
        // If there are location cards available, return one
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
        
        // All location cards exhausted - reset session and show user cards again
        await this.resetSession(userId, sessionId, preferredCity);
        
        // Try to get users again (now with reset session)
        const usersAfterReset = await this.findMatchingUsersForUser(
          userId,
          preferredCity,
          statuses,
          genders,
          soloOnly,
          [] // Session reset, so no rainchecked users
        );
        
        if (usersAfterReset.length > 0) {
          const selectedUser = this.selectBestMatch(usersAfterReset, currentUser);
          const card = await this.buildCard(selectedUser, preferredCity);
          
          if (hasActiveGenderFilter) {
            await this.genderFilterService.decrementScreen(userId);
          }

          return {
            card,
            exhausted: false
          };
        }
      } else {
        // If anywhere and exhausted, show rainchecked again (unlimited scroll)
        const allUsers = await this.findMatchingUsersForUser(
          userId,
          null,
          statuses,
          genders,
          soloOnly,
          [] // Don't exclude rainchecked - this allows cycling through same users
        );

        if (allUsers.length === 0) {
          // Only truly exhausted if there are 0 users in entire database
          // This should be extremely rare
          const suggestedCities = await this.locationService.getCitiesWithMaxUsers(10);
          return {
            card: null,
            exhausted: true,
            suggestedCities: suggestedCities.map((c) => ({
              city: c.city,
              availableCount: c.availableCount
            }))
          };
        }

        // Return a rainchecked user (unlimited scroll - cycles through same users)
        const selectedUser = this.selectBestMatch(allUsers, currentUser);
        const card = await this.buildCard(selectedUser, preferredCity);
        
        // Decrement gender filter screens only if still active
        if (hasActiveGenderFilter) {
          await this.genderFilterService.decrementScreen(userId);
        }

        return {
          card,
          exhausted: false
        };
      }
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

    return users;
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
}

