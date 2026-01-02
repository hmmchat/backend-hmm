import {
  Controller,
  Get,
  HttpException,
  HttpStatus
} from "@nestjs/common";

@Controller()
export class HomepageController {
  /**
   * Get homepage aggregated data
   * GET /homepage
   * 
   * NOTE: This endpoint will aggregate data from multiple services in the future.
   * For now, frontend should call wallet-service directly: GET /me/balance
   * 
   * Future implementation will aggregate:
   * - Coins (from wallet-service)
   * - Meeting count (from discovery-service)
   * - Active users count (from discovery-service)
   * - etc.
   */
  @Get("homepage")
  async getHomepage() {
    // TODO: Implement homepage aggregation when we have multiple data sources
    // For now, frontend should call wallet-service directly for coins
    throw new HttpException(
      "Homepage endpoint not yet implemented. Call wallet-service /me/balance directly for coins.",
      HttpStatus.NOT_IMPLEMENTED
    );
  }
}
