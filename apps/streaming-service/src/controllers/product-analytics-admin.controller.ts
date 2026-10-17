import { Controller, Get, Headers, HttpException, HttpStatus } from "@nestjs/common";
import { ProductAnalyticsService } from "../services/product-analytics.service.js";

function assertAdminToken(token: string | string[] | undefined) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    throw new HttpException("Admin API not configured", HttpStatus.SERVICE_UNAVAILABLE);
  }
  const presented = Array.isArray(token) ? token[0] : token;
  if (!presented || presented !== expected) {
    throw new HttpException("Invalid admin token", HttpStatus.UNAUTHORIZED);
  }
}

@Controller("streaming/admin/product-analytics")
export class ProductAnalyticsAdminController {
  constructor(private readonly analytics: ProductAnalyticsService) {}

  @Get()
  overview(@Headers("x-admin-token") token?: string | string[]) {
    assertAdminToken(token);
    return this.analytics.overview();
  }
}
