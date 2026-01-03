import {
  Controller,
  Get,
  Post,
  Patch,
  Query,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  HttpCode
} from "@nestjs/common";
import { LocationService } from "../services/location.service.js";
import {
  UpdatePreferredCitySchema,
  LocateMeSchema,
  SearchCitiesSchema
} from "../dtos/location.dto.js";

@Controller("location")
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  /**
   * Get list of cities with maximum users
   * GET /location/cities?limit=20
   */
  @Get("cities")
  async getCities(@Query("limit") limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new HttpException("Limit must be between 1 and 100", HttpStatus.BAD_REQUEST);
    }
    return this.locationService.getCitiesWithMaxUsers(limitNum);
  }

  /**
   * Search for cities by name
   * GET /location/search?q=mumbai&limit=20
   */
  @Get("search")
  async searchCities(@Query("q") query?: string, @Query("limit") limit?: string) {
    if (!query) {
      throw new HttpException("Search query is required", HttpStatus.BAD_REQUEST);
    }

    const dto = SearchCitiesSchema.parse({ q: query });
    const limitNum = limit ? parseInt(limit, 10) : 20;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new HttpException("Limit must be between 1 and 100", HttpStatus.BAD_REQUEST);
    }

    return this.locationService.searchCities(dto.q, limitNum);
  }

  /**
   * Get city name from latitude and longitude (locate me)
   * POST /location/locate-me
   */
  @Post("locate-me")
  @HttpCode(HttpStatus.OK)
  async locateMe(@Body() body: any) {
    const dto = LocateMeSchema.parse(body);
    return this.locationService.locateMe(dto.latitude, dto.longitude);
  }

  /**
   * Get user's preferred city
   * GET /location/preference
   */
  @Get("preference")
  async getPreferredCity(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    return this.locationService.getPreferredCity(token);
  }

  /**
   * Update user's preferred city
   * PATCH /location/preference
   */
  @Patch("preference")
  async updatePreferredCity(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    const dto = UpdatePreferredCitySchema.parse(body);
    return this.locationService.updatePreferredCity(token, dto.city);
  }
}

