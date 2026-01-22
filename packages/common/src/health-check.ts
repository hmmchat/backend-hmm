/**
 * Health Check Utilities
 * 
 * Provides standardized health check responses and database connectivity checks
 */

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  version?: string;
  checks: {
    [key: string]: {
      status: 'up' | 'down';
      message?: string;
      responseTime?: number;
    };
  };
  dependencies?: {
    [serviceName: string]: {
      status: 'up' | 'down';
      url?: string;
      responseTime?: number;
      error?: string;
    };
  };
}

export class HealthChecker {
  /**
   * Check database connectivity
   */
  static async checkDatabase(
    prisma: any,
    _serviceName: string
  ): Promise<{ status: 'up' | 'down'; message?: string; responseTime?: number }> {
    const startTime = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;
      return {
        status: 'up',
        message: 'Database connection successful',
        responseTime
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        status: 'down',
        message: `Database connection failed: ${error.message}`,
        responseTime
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  static async checkRedis(
    redis: any,
    _serviceName: string
  ): Promise<{ status: 'up' | 'down'; message?: string; responseTime?: number }> {
    const startTime = Date.now();
    try {
      await redis.ping();
      const responseTime = Date.now() - startTime;
      return {
        status: 'up',
        message: 'Redis connection successful',
        responseTime
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        status: 'down',
        message: `Redis connection failed: ${error.message}`,
        responseTime
      };
    }
  }

  /**
   * Check external service
   */
  static async checkService(
    url: string,
    timeout: number = 5000
  ): Promise<{ status: 'up' | 'down'; responseTime?: number; error?: string }> {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: controller.signal as any
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return {
          status: 'up',
          responseTime
        };
      } else {
        return {
          status: 'down',
          responseTime,
          error: `HTTP ${response.status}`
        };
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        status: 'down',
        responseTime,
        error: error.message || 'Connection failed'
      };
    }
  }

  /**
   * Create health check response
   */
  static createResponse(
    serviceName: string,
    checks: HealthCheckResult['checks'],
    dependencies?: HealthCheckResult['dependencies'],
    version?: string
  ): HealthCheckResult {
    const allChecksUp = Object.values(checks).every(c => c.status === 'up');
    const criticalChecksUp = checks.database?.status === 'up'; // Database is critical

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (allChecksUp && (!dependencies || Object.values(dependencies).every(d => d.status === 'up'))) {
      status = 'healthy';
    } else if (criticalChecksUp) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      service: serviceName,
      version,
      checks,
      dependencies
    };
  }
}
