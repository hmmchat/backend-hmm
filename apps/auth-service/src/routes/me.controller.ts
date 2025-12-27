import { Controller, Get, Patch, Body, Headers, HttpException, HttpStatus } from "@nestjs/common";
import { AuthService } from "../services/auth.service.js";
import { MetricService } from "../services/metric.service.js";
import { PreferenceSchema } from "@hmm/common";

@Controller("me")
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly metricService: MetricService // ✅ inject MetricService
  ) {}

  private getTokenFromHeader(h?: string) {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  @Get()
  async me(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    return this.auth.getMe(token);
  }

  @Patch("preferences")
  async updatePrefs(@Headers("authorization") authz: string, @Body() body: any) {
    const token = this.getTokenFromHeader(authz);
    if (!token) throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    const prefs = PreferenceSchema.parse(body);
    return this.auth.updatePreferences(token, prefs);
  }

  @Get("metrics")
  async metrics() {
    const count = await this.metricService.getMeetingsCount();
    return { liveMeetings: count };
  }
}