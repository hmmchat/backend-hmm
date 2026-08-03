/**
 * Admin authentication guard.
 * Validates X-Admin-Token header against ADMIN_API_TOKEN env var.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const headers = request.headers || {};
    const token = (headers["x-admin-token"] || headers["X-Admin-Token"]) as string | undefined;
    const expected = this.config.get<string>("ADMIN_API_TOKEN");

    if (!expected) {
      throw new HttpException("Admin API not configured", HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (!token || token !== expected) {
      throw new HttpException("Invalid admin token", HttpStatus.UNAUTHORIZED);
    }

    return true;
  }
}
