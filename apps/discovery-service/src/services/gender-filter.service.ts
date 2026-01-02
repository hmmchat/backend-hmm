import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
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
    private readonly walletClient: WalletClientService
  ) {}

  /**
   * Get gender filter configuration
   */
  private async getConfig(): Promise<{ coinsPerScreen: number; screensPerPurchase: number }> {
    try {
      const coinsConfig = await this.prisma.genderFilterConfig.findUnique({
        where: { key: "gender_filter_coins_per_screen" }
      });
      const screensConfig = await this.prisma.genderFilterConfig.findUnique({
        where: { key: "gender_filter_screens_per_purchase" }
      });

      return {
        coinsPerScreen: coinsConfig ? parseInt(coinsConfig.value, 10) : this.defaultCoinsPerScreen,
        screensPerPurchase: screensConfig ? parseInt(screensConfig.value, 10) : this.defaultScreensPerPurchase
      };
    } catch (error) {
      // If config doesn't exist, use defaults
      return {
        coinsPerScreen: this.defaultCoinsPerScreen,
        screensPerPurchase: this.defaultScreensPerPurchase
      };
    }
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
    const currentPreference = await this.prisma.genderFilterPreference.findUnique({
      where: { userId: userId }
    });

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
      // genders is stored as JSON, parse it if it's a string
      let gendersArray: string[];
      if (typeof currentPreference.genders === 'string') {
        gendersArray = JSON.parse(currentPreference.genders);
      } else if (Array.isArray(currentPreference.genders)) {
        gendersArray = currentPreference.genders as string[];
      } else {
        gendersArray = [];
      }
      
      response.currentPreference = {
        genders: gendersArray,
        screensRemaining: currentPreference.screensRemaining
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

    // Handle "ALL" option (free, default, clears filter)
    // This is allowed even for PREFER_NOT_TO_SAY users since it's the default state
    if (selectedGenders.length === 1 && selectedGenders[0] === "ALL") {
      // Delete existing preference if it exists (clear filter, back to default)
      const existingPreference = await this.prisma.genderFilterPreference.findUnique({
        where: { userId: userProfile.id }
      });

      if (existingPreference) {
        await this.prisma.genderFilterPreference.delete({
          where: { userId: userProfile.id }
        });
      }

      // No wallet deduction, no storage needed - just clear the filter
      return {
        success: true
        // No screensRemaining or newBalance for "ALL" option
      };
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

    // Get or create preference
    const existingPreference = await this.prisma.genderFilterPreference.findUnique({
      where: { userId: userProfile.id }
    });

    // Store genders as JSON string (exclude "ALL" from storage as it's not a real filter)
    const gendersToStore = selectedGenders.filter(g => g !== "ALL");
    const gendersJson = JSON.stringify(gendersToStore);

    if (existingPreference) {
      // Update existing preference
      const updated = await this.prisma.genderFilterPreference.update({
        where: { userId: userProfile.id },
        data: {
          genders: gendersJson,
          screensRemaining: existingPreference.screensRemaining + screens
        }
      });

      return {
        success: true,
        screensRemaining: updated.screensRemaining,
        newBalance: paymentResult.newBalance
      };
    } else {
      // Create new preference
      const created = await this.prisma.genderFilterPreference.create({
        data: {
          userId: userProfile.id,
          genders: gendersJson,
          screensRemaining: screens
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
    const preference = await this.prisma.genderFilterPreference.findUnique({
      where: { userId }
    });

    if (preference && preference.screensRemaining > 0) {
      await this.prisma.genderFilterPreference.update({
        where: { userId },
        data: {
          screensRemaining: preference.screensRemaining - 1
        }
      });
    }
  }

  /**
   * Get current gender filter preference for a user
   */
  async getCurrentPreference(userId: string) {
    return this.prisma.genderFilterPreference.findUnique({
      where: { userId }
    });
  }
}

