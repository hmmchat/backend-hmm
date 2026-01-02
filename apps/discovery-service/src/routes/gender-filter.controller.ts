import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { GenderFilterService } from "../services/gender-filter.service.js";
import { z } from "zod";

const ApplyGenderFilterSchema = z.object({
  genders: z.array(z.enum(["MALE", "FEMALE", "NON_BINARY", "ALL"])).min(1)
});

@Controller()
export class GenderFilterController {
  constructor(private readonly genderFilterService: GenderFilterService) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  /**
   * Get available gender filters based on user's gender
   * GET /gender-filters
   * 
   * Response:
   * - If user gender is PREFER_NOT_TO_SAY: { applicable: false, reason: "..." }
   * - If user is MALE/FEMALE: { applicable: true, availableFilters: [MALE, FEMALE], ... }
   * - If user is NON_BINARY: { applicable: true, availableFilters: [MALE, FEMALE, NON_BINARY], ... }
   */
  @Get("gender-filters")
  async getGenderFilters(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    return this.genderFilterService.getGenderFilters(token);
  }

  /**
   * Apply gender filter (purchase and activate)
   * POST /gender-filters/apply
   * 
   * Body: { genders: ["MALE", "FEMALE"] }
   * 
   * This endpoint:
   * 1. Validates user can use the filter (not PREFER_NOT_TO_SAY)
   * 2. Validates selected genders based on user's gender
   * 3. Deducts coins from wallet
   * 4. Creates/updates gender filter preference
   */
  @Post("gender-filters/apply")
  async applyGenderFilter(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const dto = ApplyGenderFilterSchema.parse(body);
    return this.genderFilterService.applyGenderFilter(token, dto.genders);
  }
}

