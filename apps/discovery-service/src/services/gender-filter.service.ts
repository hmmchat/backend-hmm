import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { UserClientService } from "./user-client.service.js";
import { WalletClientService } from "./wallet-client.service.js";

interface GenderFilterOption {
  gender: "MALE" | "FEMALE" | "NON_BINARY" | "ALL";
  label: string;
  cost: number;
  screens: number;
}

interface GenderFilterResponse {
  applicable: boolean;
  reason?: string;
  availableFilters?: GenderFilterOption[];
  currentPreference?: {
    genders: string[];
    screensRemaining: number;
    isActive: boolean;
  };
  config?: {
    coinsPerScreen: number;
    screensPerPurchase: number;
  };
}

@Injectable()
export class GenderFilterService {
  private readonly defaultCoinsPerScreen: number = 200;
  private readonly defaultScreensPerPurchase: number = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly userClient: UserClientService,
    private readonly walletClient: WalletClientService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Get gender filter configuration from environment variables
   */
  private getConfig(): { coinsPerScreen: number; screensPerPurchase: number } {
    const coinsPerScreen = this.configService.get<number>("GENDER_FILTER_COINS_PER_SCREEN", this.defaultCoinsPerScreen);
    const screensPerPurchase = this.configService.get<number>("GENDER_FILTER_SCREENS_PER_PURCHASE", this.defaultScreensPerPurchase);

    return {
      coinsPerScreen: typeof coinsPerScreen === "number" ? coinsPerScreen : parseInt(String(coinsPerScreen), 10) || this.defaultCoinsPerScreen,
      screensPerPurchase: typeof screensPerPurchase === "number" ? screensPerPurchase : parseInt(String(screensPerPurchase), 10) || this.defaultScreensPerPurchase
    };
  }

  private parseGenders(value: unknown): string[] {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(value) ? value as string[] : [];
  }

  /**
   * Get available gender filters based on user's gender
   */
  async getGenderFilters(token: string): Promise<GenderFilterResponse> {
    // Get user profile to check gender
    const userProfile = await this.userClient.getUserProfile(token);
    const userGender = userProfile?.gender;
    const userId = userProfile?.id;
    
    if (!userId) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    // Get configuration
    const config = await this.getConfig();

    // Rule 1: If user gender is "PREFER_NOT_TO_SAY", only return "ALL" option (no filter)
    if (userGender === "PREFER_NOT_TO_SAY" || userGender === null) {
      return {
        applicable: true,
        availableFilters: [
          {
            gender: "ALL",
            label: "All Gender",
            cost: 0,
            screens: 0
          }
        ],
        config: {
          coinsPerScreen: config.coinsPerScreen,
          screensPerPurchase: config.screensPerPurchase
        }
      };
    }

    // Get current preference if exists
    let currentPreference = null;
    try {
      currentPreference = await (this.prisma as any).genderFilterPreference.findUnique({
        where: { userId: userId }
      });
    } catch (error: any) {
      // If table doesn't exist, return null (no preference)
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("Gender filter table not found, returning no preference");
        currentPreference = null;
      } else {
        throw error;
      }
    }

    // Rule 2: If user is MALE or FEMALE, they can only see 2 filters (MALE, FEMALE)
    // Rule 3: If user is NON_BINARY, they see all 3 filters
    // Rule 4: All users see "All Gender" option (free, default, no filter)
    let availableFilters: GenderFilterOption[] = [];

    if (userGender === "MALE" || userGender === "FEMALE") {
      availableFilters = [
        {
          gender: "MALE",
          label: "Guys",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        },
        {
          gender: "FEMALE",
          label: "Girls",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        }
      ];
    } else if (userGender === "NON_BINARY") {
      availableFilters = [
        {
          gender: "MALE",
          label: "Guys",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        },
        {
          gender: "FEMALE",
          label: "Girls",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        },
        {
          gender: "NON_BINARY",
          label: "Nonbinary",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        }
      ];
    }

    // Add "All Gender" option at the end (free, default, no filter applied)
    availableFilters.push({
      gender: "ALL",
      label: "All Gender",
      cost: 0,
      screens: 0
    });

    const response: GenderFilterResponse = {
      applicable: true,
      availableFilters,
      config: {
        coinsPerScreen: config.coinsPerScreen,
        screensPerPurchase: config.screensPerPurchase
      }
    };

    // Add current preference if exists
    if (currentPreference) {
      response.currentPreference = {
        genders: this.parseGenders(currentPreference.genders),
        screensRemaining: currentPreference.screensRemaining,
        isActive: currentPreference.isActive ?? true
      };
    }

    return response;
  }

  /**
   * Apply gender filter (purchase and activate)
   */
  async applyGenderFilter(
    token: string,
    selectedGenders: ("MALE" | "FEMALE" | "NON_BINARY" | "ALL")[]
  ): Promise<{ success: boolean; screensRemaining?: number; newBalance?: number }> {
    // Validate selected genders
    if (!selectedGenders || selectedGenders.length === 0) {
      throw new HttpException("At least one gender must be selected", HttpStatus.BAD_REQUEST);
    }

    // Get user profile
    const userProfile = await this.userClient.getUserProfile(token);
    const userGender = userProfile.gender;

    const existingPreference = await (this.prisma as any).genderFilterPreference.findUnique({
      where: { userId: userProfile.id }
    });

    // Handle "ALL" option (free, default). If a paid pack still has screens,
    // pause it so the user can resume without paying again.
    if (selectedGenders.length === 1 && selectedGenders[0] === "ALL") {
      if (existingPreference) {
        if (existingPreference.screensRemaining > 0) {
          const paused = await (this.prisma as any).genderFilterPreference.update({
            where: { userId: userProfile.id },
            data: { isActive: false }
          });
          return {
            success: true,
            screensRemaining: paused.screensRemaining
          };
        } else {
          await (this.prisma as any).genderFilterPreference.delete({
            where: { userId: userProfile.id }
          });
        }
      }

      return { success: true };
    }

    // Rule: PREFER_NOT_TO_SAY users can only use "ALL" option
    if (userGender === "PREFER_NOT_TO_SAY" || userGender === null) {
      throw new HttpException(
        "PREFER_NOT_TO_SAY users can only use the 'All Gender' option (no filter)",
        HttpStatus.FORBIDDEN
      );
    }

    // Validate selected genders based on user's gender (exclude "ALL" from validation)
    const nonAllGenders = selectedGenders.filter(g => g !== "ALL");
    if (userGender === "MALE" || userGender === "FEMALE") {
      // Can only select MALE or FEMALE (excluding "ALL")
      const invalidGenders = nonAllGenders.filter(g => g !== "MALE" && g !== "FEMALE");
      if (invalidGenders.length > 0) {
        throw new HttpException(
          "Invalid gender selection. Male/Female users can only filter by Male or Female.",
          HttpStatus.BAD_REQUEST
        );
      }
    }
    // NON_BINARY users can select any combination (excluding "ALL")

    // Get configuration
    const config = await this.getConfig();

    // Calculate total cost (one payment per filter, regardless of number of genders selected)
    // If user selects multiple genders, they pay once for all of them
    const totalCost = config.coinsPerScreen;
    const screens = config.screensPerPurchase;

    // Store genders as JSON string (exclude "ALL" from storage as it's not a real filter)
    const gendersToStore = selectedGenders.filter(g => g !== "ALL");
    const gendersJson = JSON.stringify(gendersToStore);

    if (existingPreference) {
      // A gender pack is generic: while views remain, users can switch the
      // active paid gender without buying again.
      if (existingPreference.screensRemaining > 0) {
        const resumed = await (this.prisma as any).genderFilterPreference.update({
          where: { userId: userProfile.id },
          data: {
            genders: gendersJson,
            isActive: true
          }
        });
        return {
          success: true,
          screensRemaining: resumed.screensRemaining
        };
      }

      // Existing pack exhausted: allow a fresh purchase for any valid gender.
      const balance = await this.walletClient.getBalance(token);
      if (balance < totalCost) {
        throw new HttpException(
          `Insufficient balance. Required: ${totalCost} coins, Available: ${balance} coins`,
          HttpStatus.BAD_REQUEST
        );
      }

      const paymentResult = await this.walletClient.deductCoinsForGenderFilter(
        token,
        totalCost,
        screens
      );

      // Update existing preference
      const updated = await (this.prisma as any).genderFilterPreference.update({
        where: { userId: userProfile.id },
        data: {
          genders: gendersJson,
          screensRemaining: screens,
          isActive: true
        }
      });

      return {
        success: true,
        screensRemaining: updated.screensRemaining,
        newBalance: paymentResult.newBalance
      };
    } else {
      // Check balance
      const balance = await this.walletClient.getBalance(token);
      if (balance < totalCost) {
        throw new HttpException(
          `Insufficient balance. Required: ${totalCost} coins, Available: ${balance} coins`,
          HttpStatus.BAD_REQUEST
        );
      }

      // Deduct coins from wallet
      const paymentResult = await this.walletClient.deductCoinsForGenderFilter(
        token,
        totalCost,
        screens
      );

      // Create new preference
      const created = await (this.prisma as any).genderFilterPreference.create({
        data: {
          userId: userProfile.id,
          genders: gendersJson,
          screensRemaining: screens,
          isActive: true
        }
      });

      return {
        success: true,
        screensRemaining: created.screensRemaining,
        newBalance: paymentResult.newBalance
      };
    }
  }

  /**
   * Decrement screens remaining when user views a screen
   */
  async decrementScreen(userId: string): Promise<void> {
    try {
      const preference = await (this.prisma as any).genderFilterPreference.findUnique({
        where: { userId }
      });

      if (preference && preference.screensRemaining > 0 && (preference.isActive ?? true)) {
        const nextScreensRemaining = Math.max(0, preference.screensRemaining - 1);
        await (this.prisma as any).genderFilterPreference.update({
          where: { userId },
          data: {
            screensRemaining: nextScreensRemaining,
            ...(nextScreensRemaining === 0 ? { isActive: false } : {})
          }
        });
      }
    } catch (error: any) {
      // If table doesn't exist, skip decrement
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("Gender filter table not found, skipping screen decrement");
        return;
      }
      throw error;
    }
  }

  /**
   * Get current gender filter preference for a user
   */
  async getCurrentPreference(userId: string) {
    try {
      return await (this.prisma as any).genderFilterPreference.findUnique({
        where: { userId }
      });
    } catch (error) {
      // If Prisma client is not initialized or model doesn't exist, return null
      console.warn("Error getting gender filter preference:", error);
      return null;
    }
  }

  /* ---------- Test Methods (No Auth Required) ---------- */

  /**
   * Get gender filters for user by ID (test endpoint, bypasses auth)
   */
  async getGenderFiltersForUser(userId: string): Promise<GenderFilterResponse> {
    // Get user profile by ID
    const userProfile = await this.userClient.getUserProfileById(userId);
    const userGender = userProfile?.gender;
    
    if (!userProfile) {
      throw new HttpException("User profile not found", HttpStatus.NOT_FOUND);
    }

    // Get configuration
    const config = await this.getConfig();

    // Rule 1: If user gender is "PREFER_NOT_TO_SAY", only return "ALL" option
    if (userGender === "PREFER_NOT_TO_SAY" || userGender === null) {
      return {
        applicable: true,
        availableFilters: [
          {
            gender: "ALL",
            label: "All Gender",
            cost: 0,
            screens: 0
          }
        ],
        config: {
          coinsPerScreen: config.coinsPerScreen,
          screensPerPurchase: config.screensPerPurchase
        }
      };
    }

    // Get current preference if exists
    let currentPreference = null;
    try {
      currentPreference = await (this.prisma as any).genderFilterPreference.findUnique({
        where: { userId: userId }
      });
    } catch (error: any) {
      // If table doesn't exist, return null (no preference)
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("Gender filter table not found, returning no preference");
        currentPreference = null;
      } else {
        throw error;
      }
    }

    // Build available filters based on user gender
    let availableFilters: GenderFilterOption[] = [];

    if (userGender === "MALE" || userGender === "FEMALE") {
      availableFilters = [
        {
          gender: "MALE",
          label: "Guys",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        },
        {
          gender: "FEMALE",
          label: "Girls",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        }
      ];
    } else if (userGender === "NON_BINARY") {
      availableFilters = [
        {
          gender: "MALE",
          label: "Guys",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        },
        {
          gender: "FEMALE",
          label: "Girls",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        },
        {
          gender: "NON_BINARY",
          label: "Nonbinary",
          cost: config.coinsPerScreen,
          screens: config.screensPerPurchase
        }
      ];
    }

    // Add "All Gender" option
    availableFilters.push({
      gender: "ALL",
      label: "All Gender",
      cost: 0,
      screens: 0
    });

    const response: GenderFilterResponse = {
      applicable: true,
      availableFilters,
      config: {
        coinsPerScreen: config.coinsPerScreen,
        screensPerPurchase: config.screensPerPurchase
      }
    };

    // Add current preference if exists
    if (currentPreference) {
      response.currentPreference = {
        genders: this.parseGenders(currentPreference.genders),
        screensRemaining: currentPreference.screensRemaining,
        isActive: currentPreference.isActive ?? true
      };
    }

    return response;
  }

  /**
   * Apply gender filter for user by ID (test endpoint, bypasses auth and wallet)
   */
  async applyGenderFilterForUser(
    userId: string,
    selectedGenders: ("MALE" | "FEMALE" | "NON_BINARY" | "ALL")[]
  ): Promise<{ success: boolean; screensRemaining?: number }> {
    // Validate selected genders
    if (!selectedGenders || selectedGenders.length === 0) {
      throw new HttpException("At least one gender must be selected", HttpStatus.BAD_REQUEST);
    }

    // Get user profile by ID
    const userProfile = await this.userClient.getUserProfileById(userId);
    const userGender = userProfile.gender;

    const existingPreference = await (this.prisma as any).genderFilterPreference.findUnique({
      where: { userId: userProfile.id }
    });

    // Handle "ALL" option (free, default). Pause any unexhausted pack.
    if (selectedGenders.length === 1 && selectedGenders[0] === "ALL") {
      if (existingPreference) {
        if (existingPreference.screensRemaining > 0) {
          const paused = await (this.prisma as any).genderFilterPreference.update({
            where: { userId: userProfile.id },
            data: { isActive: false }
          });
          return { success: true, screensRemaining: paused.screensRemaining };
        } else {
          await (this.prisma as any).genderFilterPreference.delete({
            where: { userId: userProfile.id }
          });
        }
      }

      return { success: true };
    }

    // Rule: PREFER_NOT_TO_SAY users can only use "ALL" option
    if (userGender === "PREFER_NOT_TO_SAY" || userGender === null) {
      throw new HttpException(
        "PREFER_NOT_TO_SAY users can only use the 'All Gender' option (no filter)",
        HttpStatus.FORBIDDEN
      );
    }

    // Validate selected genders based on user's gender
    const nonAllGenders = selectedGenders.filter(g => g !== "ALL");
    if (userGender === "MALE" || userGender === "FEMALE") {
      const invalidGenders = nonAllGenders.filter(g => g !== "MALE" && g !== "FEMALE");
      if (invalidGenders.length > 0) {
        throw new HttpException(
          "Invalid gender selection. Male/Female users can only filter by Male or Female.",
          HttpStatus.BAD_REQUEST
        );
      }
    }

    // Get configuration
    const config = await this.getConfig();
    const screens = config.screensPerPurchase;

    const gendersToStore = selectedGenders.filter(g => g !== "ALL");
    const gendersJson = JSON.stringify(gendersToStore);

    if (existingPreference) {
      // A gender pack is generic: while views remain, users can switch the
      // active paid gender without buying again.
      if (existingPreference.screensRemaining > 0) {
        const resumed = await (this.prisma as any).genderFilterPreference.update({
          where: { userId: userProfile.id },
          data: {
            genders: gendersJson,
            isActive: true
          }
        });
        return {
          success: true,
          screensRemaining: resumed.screensRemaining
        };
      }

      const updated = await (this.prisma as any).genderFilterPreference.update({
        where: { userId: userProfile.id },
        data: {
          genders: gendersJson,
          screensRemaining: screens,
          isActive: true
        }
      });

      return {
        success: true,
        screensRemaining: updated.screensRemaining
      };
    } else {
      const created = await (this.prisma as any).genderFilterPreference.create({
        data: {
          userId: userProfile.id,
          genders: gendersJson,
          screensRemaining: screens,
          isActive: true
        }
      });

      return {
        success: true,
        screensRemaining: created.screensRemaining
      };
    }
  }
}

