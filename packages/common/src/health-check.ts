/**
 * Health Check Utilities
 * 
 * Provides standardized health check responses and database connectivity checks
 */

interface CachedServiceHealth {
  result: { status: 'up' | 'down'; responseTime?: number; error?: string };
  timestamp: number;
}

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
  private static serviceHealthCache: Map<string, CachedServiceHealth> = new Map();
  private static readonly CACHE_TTL = 8000; // 8 seconds

  /**
   * Check database connectivity (with timeout)
   */
  static async checkDatabase(
    prisma: any,
    _serviceName: string,
    timeoutMs: number = 5000  // 5 second timeout for database queries
  ): Promise<{ status: 'up' | 'down'; message?: string; responseTime?: number }> {
    const startTime = Date.now();
    try {
      // Wrap query in timeout
      const queryPromise = prisma.$queryRaw`SELECT 1`;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), timeoutMs);
      });
      
      await Promise.race([queryPromise, timeoutPromise]);
      const responseTime = Date.now() - startTime;
      return {
        status: 'up',
        message: 'Database connection successful',
        responseTime
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error.message === 'Database query timeout'
        ? `Database query timed out after ${timeoutMs}ms`
        : `Database connection failed: ${error.message}`;
      return {
        status: 'down',
        message: errorMessage,
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
   * Check external service (with caching)
   */
  static async checkService(
    url: string,
    timeout: number = 2000  // Reduced default timeout from 5000ms to 2000ms
  ): Promise<{ status: 'up' | 'down'; responseTime?: number; error?: string }> {
    // Check cache first
    const cacheKey = url;
    const cached = this.serviceHealthCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
      return cached.result;
    }

    // Cache miss or expired - perform check
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

      let result: { status: 'up' | 'down'; responseTime?: number; error?: string };
      if (response.ok) {
        result = {
          status: 'up',
          responseTime
        };
      } else {
        result = {
          status: 'down',
          responseTime,
          error: `HTTP ${response.status}`
        };
      }

      // Cache the result
      this.serviceHealthCache.set(cacheKey, {
        result,
        timestamp: now
      });

      return result;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      const result = {
        status: 'down' as const,
        responseTime,
        error: error.message || 'Connection failed'
      };

      // Cache failures too (but with shorter TTL for failures)
      this.serviceHealthCache.set(cacheKey, {
        result,
        timestamp: now
      });

      return result;
    }
  }

  /**
   * Clear health check cache (useful for testing or forced refresh)
   */
  static clearCache(): void {
    this.serviceHealthCache.clear();
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
