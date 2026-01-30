import { Injectable, HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import fetch from "node-fetch";
import { SEARCH_DEFAULT_LIMIT } from "../config/limits.config.js";

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    images: Array<{ url: string; height: number; width: number }>;
    name?: string;
  };
  external_urls: {
    spotify: string;
  };
}

interface SpotifySearchResponse {
  tracks: {
    items: SpotifyTrack[];
  };
}

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface SearchSongResult {
  id?: string; // Song ID from database (if exists)
  name: string;
  artist: string;
  albumArtUrl: string | null;
  spotifyId: string;
  albumName?: string;
  spotifyUrl: string;
}

@Injectable()
export class MusicService implements OnModuleInit {
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID || "";
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  }

  async onModuleInit() {
    // Validate Spotify credentials on startup (warn only, don't fail)
    if (!this.clientId || !this.clientSecret) {
      console.warn(
        "⚠️  Spotify credentials not configured. Music search will be disabled.\n" +
        "   To enable: Register a free Spotify Developer account at https://developer.spotify.com/\n" +
        "   Then set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables.\n" +
        "   Note: This is completely FREE - no payment required, just registration."
      );
    }
  }

  /**
   * Get Spotify access token using Client Credentials flow
   * This is FREE - no payment required, just need to register a developer account
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      // Refresh 1 minute before expiry
      return this.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new HttpException(
        "Spotify API credentials not configured. Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables. " +
        "Register for free at https://developer.spotify.com/",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`
        },
        body: "grant_type=client_credentials"
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify token request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as SpotifyTokenResponse;
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

      return this.accessToken;
    } catch (error) {
      console.error("Error getting Spotify access token:", error);
      throw new HttpException(
        "Failed to authenticate with Spotify API. Please check your credentials.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * Search for songs on Spotify
   * FREE to use - just requires free Spotify Developer account registration
   */
  async searchSongs(query: string, limit?: number): Promise<SearchSongResult[]> {
    const effectiveLimit = limit ?? SEARCH_DEFAULT_LIMIT;
    if (!query || query.trim().length === 0) {
      throw new HttpException("Search query is required", HttpStatus.BAD_REQUEST);
    }

    if (effectiveLimit < 1 || effectiveLimit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    if (!this.clientId || !this.clientSecret) {
      throw new HttpException(
        "Music search is not available. Spotify API credentials not configured. " +
        "Register for free at https://developer.spotify.com/ and set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    try {
      const token = await this.getAccessToken();
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=${effectiveLimit}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify search failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as SpotifySearchResponse;
      
      if (!data.tracks || !data.tracks.items || data.tracks.items.length === 0) {
        return [];
      }

      return data.tracks.items.map((track) => {
        // Get the largest album art image (usually the first one, which is highest quality)
        const albumArtUrl = track.album.images.length > 0 
          ? track.album.images[0].url 
          : null;

        return {
          name: track.name,
          artist: track.artists.map(a => a.name).join(", "), // Handle multiple artists
          albumArtUrl,
          spotifyId: track.id,
          albumName: track.album.name,
          spotifyUrl: track.external_urls.spotify
        };
      });
    } catch (error) {
      console.error("Error searching Spotify:", error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to search for songs. Please try again later.",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get track details from Spotify by track ID
   */
  async getTrackById(spotifyId: string): Promise<SearchSongResult | null> {
    if (!this.clientId || !this.clientSecret) {
      throw new HttpException(
        "Spotify API credentials not configured",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    try {
      const token = await this.getAccessToken();
      const url = `https://api.spotify.com/v1/tracks/${spotifyId}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const errorText = await response.text();
        throw new Error(`Spotify track fetch failed: ${response.status} ${errorText}`);
      }

      const track = (await response.json()) as SpotifyTrack;
      const albumArtUrl = track.album.images.length > 0 
        ? track.album.images[0].url 
        : null;

      return {
        name: track.name,
        artist: track.artists.map(a => a.name).join(", "),
        albumArtUrl,
        spotifyId: track.id,
        albumName: track.album.name,
        spotifyUrl: track.external_urls.spotify
      };
    } catch (error) {
      console.error("Error fetching track from Spotify:", error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        "Failed to fetch track details",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

