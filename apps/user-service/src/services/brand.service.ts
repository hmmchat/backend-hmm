import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import fetch from "node-fetch";

interface BrandfetchBrandResponse {
  name: string;
  domain: string;
  logo?: string;
  images?: {
    logo?: string;
    icon?: string;
  };
  links?: Array<{
    name: string;
    url: string;
  }>;
  colors?: Array<{
    hex: string;
    type: string;
  }>;
}

export interface SearchBrandResult {
  name: string;
  domain: string;
  logoUrl: string | null;
  brandfetchId?: string;
}

@Injectable()
export class BrandService implements OnModuleInit {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.brandfetch.io/v2";

  constructor() {
    this.apiKey = process.env.BRANDFETCH_API_KEY || "";
  }

  async onModuleInit() {
    // Validate Brandfetch credentials on startup (warn only, don't fail)
    if (!this.apiKey) {
      console.warn(
        "⚠️  Brandfetch API key not configured. Brand logo fetching will be disabled.\n" +
        "   To enable: Register a free account at https://brandfetch.com/\n" +
        "   Then set BRANDFETCH_API_KEY environment variable.\n" +
        "   Note: Free tier available with limited requests."
      );
    }
  }

  /**
   * Get brand logo from Brandfetch API by domain
   * FREE tier available - requires API key
   */
  async getBrandLogo(domain: string): Promise<SearchBrandResult | null> {
    if (!domain) {
      throw new HttpException("Domain is required", HttpStatus.BAD_REQUEST);
    }

    if (!this.apiKey) {
      throw new HttpException(
        "Brandfetch API key not configured. Please set BRANDFETCH_API_KEY environment variable. " +
        "Register for free at https://brandfetch.com/",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    try {
      // Normalize domain (remove protocol, www, trailing slash)
      const normalizedDomain = domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();

      const url = `${this.baseUrl}/brands/${normalizedDomain}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Brand not found in Brandfetch
          return null;
        }
        const errorText = await response.text();
        console.error(`Brandfetch API error: ${response.status} ${errorText}`);
        return null;
      }

      const data = (await response.json()) as BrandfetchBrandResponse;
      
      // Extract logo URL (prefer images.logo, fallback to images.icon, then logo field)
      const logoUrl = data.images?.logo || data.images?.icon || data.logo || null;

      return {
        name: data.name || normalizedDomain,
        domain: data.domain || normalizedDomain,
        logoUrl,
        brandfetchId: data.domain || normalizedDomain
      };
    } catch (error) {
      console.error("Error fetching brand from Brandfetch:", error);
      // Don't throw - return null so the app can continue without logo
      return null;
    }
  }

  /**
   * Search for brands by domain or brand name
   * Brandfetch API works with domain lookups - this tries domain lookup first, then converts name to domain
   */
  async searchBrands(query: string, limit: number = 20): Promise<SearchBrandResult[]> {
    if (!query || query.trim().length === 0) {
      throw new HttpException("Search query (domain or brand name) is required", HttpStatus.BAD_REQUEST);
    }

    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    if (!this.apiKey) {
      throw new HttpException(
        "Brand logo search is not available. Brandfetch API key not configured. " +
        "Register for free at https://brandfetch.com/ and set BRANDFETCH_API_KEY.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const results: SearchBrandResult[] = [];
    
    try {
      // Try the query as a domain first
      const brandResult = await this.getBrandLogo(query);
      
      if (brandResult) {
        results.push(brandResult);
        return results;
      }
      
      // If direct lookup fails and it looks like a brand name, try converting to domain
      if (!query.includes(".")) {
        const domain = this.nameToDomain(query);
        if (domain !== query) {
          const domainResult = await this.getBrandLogo(domain);
          if (domainResult) {
            results.push(domainResult);
            return results;
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error("Error searching Brandfetch:", error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to search for brands. Please try again later.",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Convert brand name to likely domain
   * Helper function for brands that don't have domain set
   */
  nameToDomain(brandName: string): string {
    // Simple heuristic: lowercase, remove special chars, add .com
    // This is just a fallback - ideally domain should be provided
    const normalized = brandName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/\s+/g, "");
    
    // Handle common brand name variations
    const domainMap: Record<string, string> = {
      "jbl": "jbl.com",
      "apple": "apple.com",
      "nike": "nike.com",
      "bmw": "bmw.com",
      "adidas": "adidas.com",
      "samsung": "samsung.com",
      "sony": "sony.com",
      "tesla": "tesla.com",
      "gucci": "gucci.com",
      "chanel": "chanel.com",
      "bose": "bose.com",
      "mercedesbenz": "mercedes-benz.com",
      "mercedes": "mercedes-benz.com",
      "puma": "puma.com",
      "microsoft": "microsoft.com",
      "google": "google.com"
    };

    return domainMap[normalized] || `${normalized}.com`;
  }
}
