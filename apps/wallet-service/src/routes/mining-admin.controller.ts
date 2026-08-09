import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../guards/admin-auth.guard.js";
import { MiningService } from "../services/mining.service.js";

@Controller("admin/mining")
@UseGuards(AdminAuthGuard)
export class MiningAdminController {
  constructor(private readonly miningService: MiningService) {}

  /**
   * GET /admin/mining/analytics — lifetime successful-mine counters
   */
  @Get("analytics")
  getAnalytics() {
    return this.miningService.getAnalytics();
  }
}
