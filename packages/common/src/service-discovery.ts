/**
 * Service Discovery for Production
 * 
 * Supports multiple discovery mechanisms:
 * - Environment variables (default)
 * - Kubernetes service discovery
 * - Service registry (future: Consul, etcd, etc.)
 */

export interface ServiceEndpoint {
  name: string;
  url: string;
  healthy?: boolean;
  lastChecked?: number;
}

export class ServiceDiscovery {
  private static instance: ServiceDiscovery;
  private services: Map<string, ServiceEndpoint> = new Map();
  private discoveryMode: 'env' | 'k8s' | 'registry' = 'env';

  private constructor() {
    this.discoveryMode = this.detectDiscoveryMode();
    this.initializeServices();
  }

  static getInstance(): ServiceDiscovery {
    if (!ServiceDiscovery.instance) {
      ServiceDiscovery.instance = new ServiceDiscovery();
    }
    return ServiceDiscovery.instance;
  }

  /**
   * Detect discovery mode from environment
   */
  private detectDiscoveryMode(): 'env' | 'k8s' | 'registry' {
    // Kubernetes service discovery
    if (process.env.KUBERNETES_SERVICE_HOST) {
      return 'k8s';
    }

    // Service registry (future)
    if (process.env.SERVICE_REGISTRY_URL) {
      return 'registry';
    }

    // Default: environment variables
    return 'env';
  }

  /**
   * Initialize services based on discovery mode
   */
  private initializeServices(): void {
    const serviceNames = [
      'auth-service',
      'user-service',
      'moderation-service',
      'discovery-service',
      'streaming-service',
      'wallet-service',
      'payment-service',
      'files-service',
      'friend-service',
      'api-gateway'
    ];

    for (const serviceName of serviceNames) {
      const url = this.resolveServiceUrl(serviceName);
      if (url) {
        this.services.set(serviceName, {
          name: serviceName,
          url,
          healthy: undefined,
          lastChecked: undefined
        });
      }
    }
  }

  /**
   * Resolve service URL based on discovery mode
   */
  private resolveServiceUrl(serviceName: string): string | null {
    switch (this.discoveryMode) {
      case 'k8s':
        return this.resolveKubernetesUrl(serviceName);
      case 'registry':
        return this.resolveRegistryUrl(serviceName);
      case 'env':
      default:
        return this.resolveEnvUrl(serviceName);
    }
  }

  /**
   * Resolve URL from environment variables
   */
  private resolveEnvUrl(serviceName: string): string | null {
    const envVar = serviceName.toUpperCase().replace(/-/g, '_') + '_URL';
    const url = process.env[envVar];
    
    if (url) {
      return url;
    }

    // Fallback to default localhost ports
    const portMap: Record<string, number> = {
      'api-gateway': 3000,
      'auth-service': 3001,
      'user-service': 3002,
      'moderation-service': 3003,
      'discovery-service': 3004,
      'streaming-service': 3006,  // Fixed: streaming-service runs on 3006
      'wallet-service': 3005,     // Fixed: wallet-service runs on 3005
      'payment-service': 3007,
      'files-service': 3008,
      'friend-service': 3009
    };

    const port = portMap[serviceName];
    if (port) {
      return `http://localhost:${port}`;
    }

    return null;
  }

  /**
   * Resolve URL from Kubernetes service discovery
   */
  private resolveKubernetesUrl(serviceName: string): string {
    const namespace = process.env.KUBERNETES_NAMESPACE || 'default';
    const servicePort = process.env[`${serviceName.toUpperCase().replace(/-/g, '_')}_PORT`] || '80';
    
    // Kubernetes DNS format: <service-name>.<namespace>.svc.cluster.local
    return `http://${serviceName}.${namespace}.svc.cluster.local:${servicePort}`;
  }

  /**
   * Resolve URL from service registry (future implementation)
   */
  private resolveRegistryUrl(serviceName: string): string | null {
    // TODO: Implement service registry lookup
    // For now, fallback to env
    return this.resolveEnvUrl(serviceName);
  }

  /**
   * Get service URL
   */
  getServiceUrl(serviceName: string): string {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found in service discovery`);
    }
    return service.url;
  }

  /**
   * Get all services
   */
  getAllServices(): ServiceEndpoint[] {
    return Array.from(this.services.values());
  }

  /**
   * Update service health status
   */
  updateHealth(serviceName: string, healthy: boolean): void {
    const service = this.services.get(serviceName);
    if (service) {
      service.healthy = healthy;
      service.lastChecked = Date.now();
    }
  }

  /**
   * Get discovery mode
   */
  getDiscoveryMode(): string {
    return this.discoveryMode;
  }
}
