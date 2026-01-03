import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserClientService } from "./user-client.service.js";
import { GenderFilterService } from "./gender-filter.service.js";
import { LocationService } from "./location.service.js";

interface DiscoveryUser {
  id: string;
  username: string | null;
  dateOfBirth: Date | null;
  gender: "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY" | null;
  displayPictureUrl: string | null;
  preferredCity: string | null;
  intent: string | null;
  status: string;
  photos: Array<{ id: string; url: string; order: number }>;
  musicPreference: { id: string; name: string; artist: string; albumArtUrl: string | null } | null;
  brandPreferences: Array<{ brand: { id: string; name: string; logoUrl: string | null } }>;
  interests: Array<{ interest: { id: string; name: string } }>;
  values: Array<{ value: { id: string; name: string } }>;
}

interface UserProfile {
  id: string;
  preferredCity: string | null;
  brandPreferences?: Array<{ brand: { id: string; name: string } }>;
  interests?: Array<{ interest: { id: string; name: string } }>;
  values?: Array<{ value: { id: string; name: string } }>;
  musicPreference?: { id: string } | null;
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
}

interface CardResponse {
  card: Card | null;
  exhausted: boolean;
  suggestedCities?: Array<{ city: string; country?: string; availableCount: number }>;
}

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userClient: UserClientService,
    private readonly genderFilterService: GenderFilterService,
    private readonly locationService: LocationService
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
    
    // Convert to UserProfile interface
    const currentUser: UserProfile = {
      id: userProfileResponse.id,
      preferredCity: preferredCity,
      brandPreferences: (userProfileResponse as any).brandPreferences,
      interests: (userProfileResponse as any).interests,
      values: (userProfileResponse as any).values,
      musicPreference: (userProfileResponse as any).musicPreference
    };

    // Get gender filter preference
    const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
    // Apply gender filter ONLY when screensRemaining > 0 (user paid for it)
    // When screensRemaining = 0, filter is exhausted, show all genders
    const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;

    // Determine statuses to filter
    const statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[] = soloOnly
      ? ["AVAILABLE"]
      : ["AVAILABLE", "IN_SQUAD_AVAILABLE", "IN_BROADCAST_AVAILABLE"];

    // Get rainchecked user IDs for this session and city
    const raincheckedUserIds = await this.getRaincheckedUserIds(userId, sessionId, preferredCity);

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

    // Find matching users
    const matchingUsers = await this.findMatchingUsers(
      token,
      userId,
      preferredCity,
      statuses,
      genders,
      soloOnly,
      raincheckedUserIds
    );

    // If no matches found, check if we should show fallback
    if (matchingUsers.length === 0) {
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

        // If no users of this gender exist anywhere, show city options
        // User can switch cities and continue seeing filtered gender until screensRemaining = 0
        if (usersInOtherCities.length === 0) {
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
      }

      // If user has a city preference, suggest top cities or anywhere
      if (preferredCity) {
        const suggestedCities = await this.locationService.getCitiesWithMaxUsers(10);
        return {
          card: null,
          exhausted: true,
          suggestedCities: suggestedCities.map((c) => ({
            city: c.city,
            availableCount: c.availableCount
          }))
        };
      } else {
        // If anywhere and exhausted, show rainchecked again (without session reset)
        // Only apply gender filter if still active (screensRemaining > 0)
        const allUsers = await this.findMatchingUsers(
          token,
          userId,
          null,
          statuses,
          genders, // only applies if hasActiveGenderFilter is true
          soloOnly,
          [] // Don't exclude rainchecked
        );

        if (allUsers.length === 0) {
          // Truly exhausted - suggest cities
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

        // Return a rainchecked user
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

    // Select best match based on preference scoring
    const selectedUser = this.selectBestMatch(matchingUsers, currentUser);
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

    // Interests (equal weight)
    const userInterestIds = new Set(
      (user.interests || []).map((i) => i.interest.id)
    );
    const targetInterestIds = new Set(
      targetUser.interests.map((i) => i.interest.id)
    );
    const commonInterests = [...userInterestIds].filter((id) => targetInterestIds.has(id));
    score += commonInterests.length * 10;

    // Values (equal weight)
    const userValueIds = new Set(
      (user.values || []).map((v) => v.value.id)
    );
    const targetValueIds = new Set(
      targetUser.values.map((v) => v.value.id)
    );
    const commonValues = [...userValueIds].filter((id) => targetValueIds.has(id));
    score += commonValues.length * 10;

    // Music preference (equal weight)
    if (
      user.musicPreference?.id &&
      targetUser.musicPreference?.id &&
      user.musicPreference.id === targetUser.musicPreference.id
    ) {
      score += 10;
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
      status: user.status as "AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE"
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
    const rainchecks = await (this.prisma as any).raincheckSession.findMany({
      where: {
        userId,
        sessionId,
        city: city || null
      },
      select: {
        raincheckedUserId: true
      }
    });

    return rainchecks.map((r: { raincheckedUserId: string }) => r.raincheckedUserId);
  }

  /**
   * Mark user as rainchecked
   */
  async markRaincheck(
    userId: string,
    sessionId: string,
    raincheckedUserId: string,
    city: string | null
  ): Promise<void> {
    // Check if already rainchecked in this session
    const existing = await (this.prisma as any).raincheckSession.findFirst({
      where: {
        userId,
        sessionId,
        raincheckedUserId,
        city: city || null
      }
    });

    if (!existing) {
      await (this.prisma as any).raincheckSession.create({
        data: {
          userId,
          sessionId,
          raincheckedUserId,
          city: city || null
        }
      });
    }
  }

  /**
   * Reset rainchecked users for a session (when city changes)
   */
  async resetSession(userId: string, sessionId: string, city: string | null): Promise<void> {
    await (this.prisma as any).raincheckSession.deleteMany({
      where: {
        userId,
        sessionId,
        city: city || null
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
    
    // Convert to UserProfile interface
    const currentUser: UserProfile = {
      id: userProfileResponse.id,
      preferredCity: preferredCity,
      brandPreferences: (userProfileResponse as any).brandPreferences,
      interests: (userProfileResponse as any).interests,
      values: (userProfileResponse as any).values,
      musicPreference: (userProfileResponse as any).musicPreference
    };

    // Get gender filter preference
    const genderFilter = await this.genderFilterService.getCurrentPreference(userId);
    const hasActiveGenderFilter = genderFilter && genderFilter.screensRemaining > 0;

    // Determine statuses to filter
    const statuses: ("AVAILABLE" | "IN_SQUAD_AVAILABLE" | "IN_BROADCAST_AVAILABLE")[] = soloOnly
      ? ["AVAILABLE"]
      : ["AVAILABLE", "IN_SQUAD_AVAILABLE", "IN_BROADCAST_AVAILABLE"];

    // Get rainchecked user IDs for this session and city
    const raincheckedUserIds = await this.getRaincheckedUserIds(userId, sessionId, preferredCity);

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

    // Find matching users (using a fake token - won't be validated in test mode)
    const matchingUsers = await this.findMatchingUsersForUser(
      userId,
      preferredCity,
      statuses,
      genders,
      soloOnly,
      raincheckedUserIds
    );

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

        // If no users of this gender exist anywhere, show city options
        if (usersInOtherCities.length === 0) {
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
      }

      // If user has a city preference, suggest top cities or anywhere
      if (preferredCity) {
        const suggestedCities = await this.locationService.getCitiesWithMaxUsers(10);
        return {
          card: null,
          exhausted: true,
          suggestedCities: suggestedCities.map((c) => ({
            city: c.city,
            availableCount: c.availableCount
          }))
        };
      } else {
        // If anywhere and exhausted, show rainchecked again (without session reset)
        const allUsers = await this.findMatchingUsersForUser(
          userId,
          null,
          statuses,
          genders,
          soloOnly,
          [] // Don't exclude rainchecked
        );

        if (allUsers.length === 0) {
          // Truly exhausted - suggest cities
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

        // Return a rainchecked user
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

    // Select best match based on preference scoring
    const selectedUser = this.selectBestMatch(matchingUsers, currentUser);
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
}

