/**
 * Service Client Base with Circuit Breaker and Graceful Degradation
 * 
 * Provides:
 * - Circuit breaker pattern to prevent cascading failures
 * - Retry logic with exponential backoff
 * - Graceful degradation with fallbacks
 * - Health check integration
 */

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime?: number;
  successCount: number;
}

export interface ServiceClientConfig {
  serviceName: string;
  baseUrl: string;
  timeout?: number;
  retries?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
  fallback?: () => Promise<any>;
  onFailure?: (error: Error) => void;
}

export class ServiceClient {
  private circuitBreaker: CircuitBreakerState;
  private config: Required<ServiceClientConfig>;

  constructor(config: ServiceClientConfig) {
    this.config = {
      timeout: 5000,
      retries: 2,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000, // 1 minute
      fallback: async () => {
        throw new Error(`Service ${config.serviceName} unavailable and no fallback provided`);
      },
      onFailure: () => {},
      ...config
    };
    
    this.circuitBreaker = {
      state: 'closed',
      failures: 0,
      successCount: 0
    };
  }

  /**
   * Check if circuit breaker allows requests
   */
  private canMakeRequest(): boolean {
    if (this.circuitBreaker.state === 'closed') {
      return true;
    }

    if (this.circuitBreaker.state === 'open') {
      const timeSinceLastFailure = Date.now() - (this.circuitBreaker.lastFailureTime || 0);
      if (timeSinceLastFailure > this.config.circuitBreakerTimeout) {
        // Transition to half-open
        this.circuitBreaker.state = 'half-open';
        this.circuitBreaker.successCount = 0;
        return true;
      }
      return false;
    }

    // half-open state - allow one request to test
    return true;
  }

  /**
   * Record success
   */
  private recordSuccess(): void {
    if (this.circuitBreaker.state === 'half-open') {
      this.circuitBreaker.successCount++;
      if (this.circuitBreaker.successCount >= 2) {
        // Close circuit after 2 successful requests
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.successCount = 0;
      }
    } else {
      // Reset failure count on success
      this.circuitBreaker.failures = Math.max(0, this.circuitBreaker.failures - 1);
    }
  }

  /**
   * Record failure
   */
  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
      this.circuitBreaker.state = 'open';
      this.config.onFailure?.(new Error(`Circuit breaker opened for ${this.config.serviceName}`));
    }

    if (this.circuitBreaker.state === 'half-open') {
      // Failed in half-open, go back to open
      this.circuitBreaker.state = 'open';
    }
  }

  /**
   * Retry with exponential backoff
   */
  private async retry<T>(
    fn: () => Promise<T>,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= this.config.retries) {
        throw error;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retry(fn, attempt + 1);
    }
  }

  /**
   * Make HTTP request with circuit breaker, retries, and graceful degradation
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Check circuit breaker
    if (!this.canMakeRequest()) {
      this.config.onFailure?.(new Error(`Circuit breaker is open for ${this.config.serviceName}`));
      return this.config.fallback!();
    }

    const url = `${this.config.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await this.retry(async () => {
        const res = await fetch(url, {
          ...options,
          signal: controller.signal
        } as any);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return res;
      });

      clearTimeout(timeoutId);
      this.recordSuccess();
      
      return await response.json() as T;
    } catch (error: any) {
      clearTimeout(timeoutId);
      this.recordFailure();

      // Try fallback
      try {
        return await this.config.fallback!();
      } catch (fallbackError) {
        throw new Error(
          `Service ${this.config.serviceName} request failed: ${error.message}. ` +
          `Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
        );
      }
    }
  }

  /**
   * Get circuit breaker state
   */
  getState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  /**
   * Reset circuit breaker (for testing/recovery)
   */
  reset(): void {
    this.circuitBreaker = {
      state: 'closed',
      failures: 0,
      successCount: 0
    };
  }
}
