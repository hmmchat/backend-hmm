import { Injectable } from "@nestjs/common";
import { UserClientService } from "./user-client.service.js";

@Injectable()
export class MetricService {
  constructor(private readonly userClient: UserClientService) {}

  /**
   * Get count of users available + in calls, squad and broadcast
   * Counts users with statuses:
   * - AVAILABLE: Users available on the app
   * - IN_SQUAD: Users in squad (not available for more calls)
   * - IN_SQUAD_AVAILABLE: Users in squad but available
   * - IN_BROADCAST: Users broadcasting (not available for more calls)
   * - IN_BROADCAST_AVAILABLE: Users broadcasting and available
   */
  async getActiveMeetingsCount(): Promise<number> {
    return this.userClient.getActiveMeetingsCount();
  }
}

