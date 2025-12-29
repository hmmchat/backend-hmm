import { Controller, Get } from "@nestjs/common";
import { MetricService } from "../services/metric.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricService: MetricService) {}

  @Get("meetings")
  async meetings() {
    const count = await this.metricService.getMeetingsCount();
    return { liveMeetings: count };
  }
}

