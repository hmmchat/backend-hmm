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

type MusicBrowseSet = {
  name: string;
  market: string;
  seeds: string[];
};

@Injectable()
export class MusicService implements OnModuleInit {
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private readonly clientId: string;
  private readonly clientSecret: string;
  /** Cached idle suggestion pools keyed by set name. */
  private readonly suggestionCache = new Map<
    string,
    { expiresAt: number; songs: SearchSongResult[] }
  >();
  private readonly suggestionTtlMs = 30 * 60 * 1000;

  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID || "";
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  }

  /**
   * Idle rails for the song picker. Built from Spotify Search (client credentials) —
   * Recommendations / featured / editorial playlist APIs are unavailable for our app type.
   */
  private musicBrowseSets(): MusicBrowseSet[] {
    return [
      {
        name: "Trending in India",
        market: "IN",
        seeds: [
          "bollywood hits",
          "hindi hits 2025",
          "punjabi hits",
          "tamil hits 2025",
          "india viral",
          "year:2025 genre:pop"
        ]
      },
      {
        name: "Worldwide hits",
        market: "US",
        seeds: [
          "top hits 2025",
          "viral hits",
          "pop hits 2025",
          "global hits",
          "year:2025 genre:pop",
          "year:2025 genre:dance"
        ]
      },
      {
        name: "Meme and viral",
        market: "US",
        seeds: [
          "tiktok viral songs",
          "meme songs",
          "viral tiktok 2025",
          "internet viral hits",
          "phonk viral",
          "reel viral songs"
        ]
      }
    ];
  }

  private static readonly IDLE_POOL_CACHE_KEY = "__idle_all__";

  getMusicSets(): { sets: { name: string }[] } {
    return { sets: this.musicBrowseSets().map((set) => ({ name: set.name })) };
  }

  private resolveMusicSet(name: string): MusicBrowseSet | null {
    const needle = (name || "").trim().toLowerCase();
    if (!needle) return null;
    return this.musicBrowseSets().find((set) => set.name.toLowerCase() === needle) ?? null;
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private mapSpotifyTrack(track: SpotifyTrack): SearchSongResult {
    const albumArtUrl =
      track.album?.images?.length > 0 ? track.album.images[0].url : null;
    return {
      name: track.name,
      artist: (track.artists || []).map((a) => a.name).join(", "),
      albumArtUrl,
      spotifyId: track.id,
      albumName: track.album?.name,
      spotifyUrl: track.external_urls?.spotify
    };
  }

  private dedupeSongs(songs: SearchSongResult[]): SearchSongResult[] {
    const seen = new Set<string>();
    const out: SearchSongResult[] = [];
    for (const song of songs) {
      const key = song.spotifyId || `${song.name}\0${song.artist}`.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(song);
    }
    return out;
  }

  /**
   * Low-level Spotify track search. `limit` is capped at 10 (Spotify Dev Mode / 2026 search max).
   */
  private async searchSpotifyTracks(
    query: string,
    opts: { limit?: number; offset?: number; market?: string } = {}
  ): Promise<SearchSongResult[]> {
    const token = await this.getAccessToken();
    const limit = Math.min(10, Math.max(1, opts.limit ?? 10));
    const offset = Math.max(0, opts.offset ?? 0);
    const searchParams = new URLSearchParams();
    searchParams.append("q", query);
    searchParams.append("type", "track");
    searchParams.append("limit", String(limit));
    if (offset > 0) searchParams.append("offset", String(offset));
    if (opts.market) searchParams.append("market", opts.market);

    const url = `https://api.spotify.com/v1/search?${searchParams.toString()}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Spotify search failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as SpotifySearchResponse;
    const items = data.tracks?.items || [];
    return items.filter((t) => t?.id && t?.name).map((t) => this.mapSpotifyTrack(t));
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
   * Search for songs on Spotify (typed picker search).
   * Paginates in pages of 10 when the client asks for more than Spotify's search page size.
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
      const pages = Math.ceil(effectiveLimit / 10);
      const chunks = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          this.searchSpotifyTracks(query.trim(), {
            limit: Math.min(10, effectiveLimit - i * 10),
            offset: i * 10
          })
        )
      );
      return this.dedupeSongs(chunks.flat()).slice(0, effectiveLimit);
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

  private async loadSetPool(set: MusicBrowseSet): Promise<SearchSongResult[]> {
    const cached = this.suggestionCache.get(set.name);
    if (cached && cached.expiresAt > Date.now() && cached.songs.length > 0) {
      return cached.songs;
    }

    const seeds = this.shuffle([...set.seeds]);
    const chunks = await Promise.all(
      seeds.flatMap((seed) =>
        [0, 10].map((offset) =>
          this.searchSpotifyTracks(seed, {
            limit: 10,
            offset,
            market: set.market
          }).catch((error) => {
            console.warn(
              `[MusicService] suggestion seed "${seed}" offset=${offset} failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            return [] as SearchSongResult[];
          })
        )
      )
    );

    const merged = this.dedupeSongs(chunks.flat());
    this.suggestionCache.set(set.name, {
      expiresAt: Date.now() + this.suggestionTtlMs,
      songs: merged
    });
    return merged;
  }

  /**
   * Idle suggestions for one browse set. Search-seeded + cached.
   */
  async getSongsBySet(setName: string, limit: number = 50): Promise<SearchSongResult[]> {
    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    const set = this.resolveMusicSet(setName);
    if (!set) {
      throw new HttpException("Unknown music set", HttpStatus.BAD_REQUEST);
    }

    if (!this.clientId || !this.clientSecret) {
      throw new HttpException(
        "Music suggestions are not available. Spotify API credentials not configured.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    try {
      const pool = await this.loadSetPool(set);
      return this.shuffle(pool).slice(0, limit);
    } catch (error) {
      console.error("Error loading music suggestions:", error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        "Failed to load music suggestions. Please try again later.",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Flat idle feed: India + Worldwide + meme/viral Search seeds, shuffled.
   * Used when the song picker is empty (no category chips).
   */
  async getIdleSuggestions(limit: number = 50): Promise<SearchSongResult[]> {
    if (limit < 1 || limit > 50) {
      throw new HttpException("Limit must be between 1 and 50", HttpStatus.BAD_REQUEST);
    }

    if (!this.clientId || !this.clientSecret) {
      throw new HttpException(
        "Music suggestions are not available. Spotify API credentials not configured.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const cached = this.suggestionCache.get(MusicService.IDLE_POOL_CACHE_KEY);
    if (cached && cached.expiresAt > Date.now() && cached.songs.length > 0) {
      return this.shuffle(cached.songs).slice(0, limit);
    }

    try {
      const pools = await Promise.all(
        this.musicBrowseSets().map((set) => this.loadSetPool(set))
      );
      const merged = this.dedupeSongs(pools.flat());
      this.suggestionCache.set(MusicService.IDLE_POOL_CACHE_KEY, {
        expiresAt: Date.now() + this.suggestionTtlMs,
        songs: merged
      });
      return this.shuffle(merged).slice(0, limit);
    } catch (error) {
      console.error("Error loading idle music suggestions:", error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        "Failed to load music suggestions. Please try again later.",
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

