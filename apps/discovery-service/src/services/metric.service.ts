import { Injectable } from "@nestjs/common";
import { UserClientService } from "./user-client.service.js";

@Injectable()
export class MetricService {
  constructor(private readonly userClient: UserClientService) {}

  /** Proxies user-service: total profiles in the app (all statuses). */
  async getActiveMeetingsCount(): Promise<number> {
    return this.userClient.getActiveMeetingsCount();
  }
}

