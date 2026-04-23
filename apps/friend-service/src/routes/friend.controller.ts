import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Query,
  Param,
  UseGuards
} from "@nestjs/common";
import { FriendService } from "../services/friend.service.js";
import { RateLimitGuard } from "../guards/rate-limit.guard.js";
import { ConversationRateLimitGuard } from "../guards/conversation-rate-limit.guard.js";
import { NotificationRateLimitGuard } from "../guards/notification-rate-limit.guard.js";
import { ShareRateLimitGuard } from "../guards/share-rate-limit.guard.js";
import { FriendsWallImageService } from "../services/friends-wall-image.service.js";
import { FilesClientService } from "../services/files-client.service.js";
import { MetricsService } from "../services/metrics.service.js";
import { GiftCatalogService, resolveGiftStickerUrl } from "../services/gift-catalog.service.js";
import { GiphyService } from "../services/giphy.service.js";
import { z } from "zod";
import { verifyToken, AccessPayload } from "@hmm/common";
import { JWK } from "jose";
import * as crypto from "crypto";

/** GIPHY CDN paths often look like /media/<id>/giphy.gif */
function deriveGiphyIdFromUrl(urlStr: string): string | null {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/media\/([^/]+)/);
    if (m?.[1]) return m[1];
  } catch {
    // ignore
  }
  return null;
}

/** Stable synthetic id when provider id is unknown (must be non-empty for DB). */
function syntheticGifIdFromUrl(urlStr: string): string {
  return `url_${crypto.createHash("sha256").update(urlStr).digest("hex").slice(0, 32)}`;
}

const GifInputSchema = z
  .object({
    provider: z.literal("giphy").optional().default("giphy"),
    id: z.string().optional(),
    /** Frontend (hmm) sends this instead of `id` — treat as alias */
    giphyId: z.string().optional(),
    url: z.string().optional(),
    gifUrl: z.string().optional(),
    previewUrl: z.string().optional(),
    preview_url: z.string().optional(),
    width: z.coerce.number().int().positive().optional(),
    height: z.coerce.number().int().positive().optional()
  })
  .transform((val) => {
    const url = (val.url || val.gifUrl || "").trim();
    const previewUrl = (val.previewUrl || val.preview_url || "").trim() || undefined;
    const explicit = (val.id || val.giphyId || "").trim();
    const fromUrl = deriveGiphyIdFromUrl(url) || deriveGiphyIdFromUrl(previewUrl || "");
    const id = explicit || fromUrl || (url ? syntheticGifIdFromUrl(url) : "");
    return {
      provider: "giphy" as const,
      id,
      url,
      previewUrl,
      width: val.width,
      height: val.height
    };
  })
  .refine((val) => {
    try {
      // Allow frontend to send either `url` or `gifUrl`; must be a real URL.
      // (If empty/invalid, we return 400 instead of 500.)
      // eslint-disable-next-line no-new
      new URL(val.url);
      if (val.previewUrl) {
        // eslint-disable-next-line no-new
        new URL(val.previewUrl);
      }
      return true;
    } catch {
      return false;
    }
  }, { message: "gif.url must be a valid URL" });

const SendMessageSchema = z.object({
  message: z.string().max(1000).nullable().optional().transform((val) => {
    if (val === "" || val === null || val === undefined) return null;
    return val;
  }),
  giftId: z.string().optional(),
  giftAmount: z.coerce.number().positive().optional(),
  gif: GifInputSchema.optional()
}).refine(
  (data) => {
    // Either message (non-empty) or giftId or gif must be provided
    const hasMessage = data.message && data.message.trim().length > 0;
    const hasGift = data.giftId && data.giftId.trim().length > 0;
    const hasGif = !!data.gif;
    return hasMessage || hasGift || hasGif;
  },
  { message: "Either message or giftId must be provided" }
).refine(
  (data) => {
    // Prevent mixed media types in a single message
    if (data.gif && data.giftId) return false;
    return true;
  },
  { message: "Cannot send a gift and a GIF in the same message" }
);

function parseOrBadRequest<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new HttpException(
    {
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Invalid request",
      issues: parsed.error.issues
    },
    HttpStatus.BAD_REQUEST
  );
}

const PaginationSchema = z.object({
  limit: z.string().optional().transform((val) => val ? Math.min(parseInt(val, 10), 100) : 50), // Max 100
  cursor: z.string().optional()
});

const ConversationFilterSchema = z.enum(["text_only", "with_gift", "only_follows"], {
  errorMap: () => ({ message: "Filter must be one of: text_only, with_gift, or only_follows" })
});

const ConversationQuerySchema = PaginationSchema.extend({
  filter: ConversationFilterSchema.optional()
});

@Controller()
export class FriendController {
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private jwtInitialized = false;

  constructor(
    private readonly friendService: FriendService,
    private readonly friendsWallImageService: FriendsWallImageService,
    private readonly filesClient: FilesClientService,
    private readonly metrics: MetricsService,
    private readonly giftCatalogService: GiftCatalogService,
    private readonly giphy: GiphyService
  ) { }

  private async initializeJWT() {
    if (this.jwtInitialized) return;

    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;
    this.verifyAccess = await verifyToken(this.publicJwk);
    this.jwtInitialized = true;
  }

  private getTokenFromHeader(h?: string): string | null {
    if (!h) return null;
    const [t, v] = h.split(" ");
    return t?.toLowerCase() === "bearer" ? v : null;
  }

  private async verifyTokenAndGetUserId(token: string): Promise<string> {
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }
    await this.initializeJWT();
    try {
      const payload = await this.verifyAccess(token);
      return payload.sub;
    } catch (error: any) {
      if (error.code === 'ERR_JWT_EXPIRED') {
        throw new HttpException("Token expired", HttpStatus.UNAUTHORIZED);
      }
      throw new HttpException("Invalid token", HttpStatus.UNAUTHORIZED);
    }
  }

  private verifyInternalServiceToken(serviceToken: string | undefined): void {
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      if (serviceToken !== expectedToken) {
        throw new HttpException("Invalid service token", HttpStatus.UNAUTHORIZED);
      }
    }
  }

  // NOTE: Friend requests can ONLY be sent during video calls via the "+" button
  // OR from OFFLINE cards section (new feature)
  // All other friend requests must go through the streaming-service WebSocket handler
  // See: /internal/friends/requests (internal endpoint called by streaming-service)

  /**
   * Get pending requests (incoming)
   * GET /me/friends/requests/pending
   */
  @Get("me/friends/requests/pending")
  async getPendingRequests(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    // Auto-mark FRIEND_REQUESTS section as seen
    await this.friendService.markSectionAsSeen(userId, "FRIEND_REQUESTS");
    return this.friendService.getPendingRequests(userId);
  }

  /**
   * Get sent requests (outgoing)
   * GET /me/friends/requests/sent
   */
  @Get("me/friends/requests/sent")
  async getSentRequests(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.friendService.getSentRequests(userId);
  }

  /**
   * Get messages for a pending request
   * GET /me/friends/requests/:requestId/messages
   */
  @Get("me/friends/requests/:requestId/messages")
  async getRequestMessages(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.friendService.getRequestMessages(requestId, userId);
  }

  /**
   * Accept friend request
   * POST /me/friends/requests/:requestId/accept
   */
  @Post("me/friends/requests/:requestId/accept")
  async acceptRequest(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.acceptFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Reject friend request
   * POST /me/friends/requests/:requestId/reject
   */
  @Post("me/friends/requests/:requestId/reject")
  async rejectRequest(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.rejectFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Send friend request from OFFLINE cards section
   * POST /me/friends/offline-cards/request
   * This is the ONLY public endpoint for sending friend requests (besides video calls)
   */
  @Post("me/friends/offline-cards/request")
  async sendFriendRequestFromOfflineCard(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const fromUserId = await this.verifyTokenAndGetUserId(token!);

    const schema = z.object({
      toUserId: z.string().min(1, "toUserId is required")
    });
    const { toUserId } = schema.parse(body);

    const result = await this.friendService.sendFriendRequest(fromUserId, toUserId);
    return {
      ok: true,
      requestId: result.requestId,
      autoAccepted: result.autoAccepted
    };
  }

  /**
   * Get all friends with pagination
   * GET /me/friends
   * Query params: ?limit=50&cursor=xxx
   */
  @Get("me/friends")
  async getFriends(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const limit = query?.limit ? parseInt(query.limit, 10) : 50;
    const cursor = query?.cursor;
    return this.friendService.getFriends(userId, limit, cursor);
  }

  /**
   * Get friends wall - paginated friends with profile photos
   * GET /me/friends/wall
   * Query params: ?limit=35&cursor=xxx
   * Returns friends with displayPictureUrl for grid display
   */
  @Get("me/friends/wall")
  async getFriendsWall(
    @Headers("authorization") authz?: string,
    @Query() query?: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const limit = query?.limit ? parseInt(query.limit, 10) : undefined;
    const cursor = query?.cursor;
    return this.friendService.getFriendsWall(userId, limit, cursor);
  }

  /**
   * Generate and share friends wall image
   * POST /me/friends/wall/share
   * Returns imageUrl, deepLink, and productLink for sharing
   */
  @Post("me/friends/wall/share")
  @UseGuards(ShareRateLimitGuard)
  async shareFriendsWall(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const startTime = Date.now();

    try {
      // Get friends wall to generate hash for cache
      const friendsWall = await this.friendService.getFriendsWall(userId, 35);
      const friendIds = friendsWall.friends.map(f => f.friendId);
      const friendsHash = crypto.createHash("md5").update([...friendIds].sort().join(",")).digest("hex");

      // Check cache using FriendsWallImageService
      const cached = await this.friendsWallImageService.getCachedImage(userId, friendsHash);

      if (cached) {
        // Track cache hit
        const duration = Date.now() - startTime;
        this.metrics.incrementFriendsWallShareCacheHit();
        this.metrics.incrementFriendsWallShareGenerated(true, duration);

        return {
          imageUrl: cached.imageUrl,
          deepLink: cached.deepLink,
          productLink: this.friendsWallImageService.getProductLink()
        };
      }

      // Generate image (metrics tracked inside generateImage)
      const imageBuffer = await this.friendsWallImageService.generateImage(userId);

      // Upload to files-service
      const timestamp = Date.now();
      const filename = `friends-wall-${userId}-${timestamp}.jpg`;
      const uploadResult = await this.filesClient.uploadImage(imageBuffer, filename, userId);

      // Cache the result using FriendsWallImageService
      await this.friendsWallImageService.cacheImage(userId, friendsHash, uploadResult.url, uploadResult.url, uploadResult.fileId);

      return {
        imageUrl: uploadResult.url,
        deepLink: uploadResult.url, // Deep link is same as image URL
        productLink: this.friendsWallImageService.getProductLink()
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.metrics.incrementFriendsWallShareGenerated(false, duration);

      // Determine error type for better error messages
      let errorCode = "IMAGE_GENERATION_FAILED";
      let retryable = true;

      if (error.message?.includes("Puppeteer") || error.message?.includes("browser")) {
        errorCode = "PUPPETEER_FAILED";
      } else if (error.message?.includes("upload") || error.message?.includes("files-service")) {
        errorCode = "UPLOAD_FAILED";
        retryable = true;
      } else if (error.message?.includes("timeout")) {
        errorCode = "TIMEOUT";
        retryable = true;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Failed to generate friend wall image. Please try again.",
          error: "Image Generation Failed",
          code: errorCode,
          retryable
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Send message to friend (free, supports gifts)
   * POST /me/friends/:friendId/messages
   */
  @Post("me/friends/:friendId/messages")
  @UseGuards(RateLimitGuard)
  async sendMessageToFriend(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = parseOrBadRequest(SendMessageSchema, body);
    return this.friendService.sendMessageToFriend(
      userId,
      friendId,
      dto.message || null,
      dto.giftId,
      dto.giftAmount,
      dto.gif
    );
  }

  /**
   * Send message to non-friend (costs coins, supports gifts)
   * POST /me/friends/requests/:requestId/messages
   */
  @Post("me/friends/requests/:requestId/messages")
  @UseGuards(RateLimitGuard)
  async sendMessageToNonFriend(
    @Headers("authorization") authz: string,
    @Param("requestId") requestId: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = parseOrBadRequest(SendMessageSchema, body);
    const request = await this.friendService.getRequest(requestId);
    return this.friendService.sendMessageToNonFriend(
      userId,
      request.toUserId,
      dto.message || null,
      requestId,
      dto.giftId,
      dto.giftAmount,
      dto.gif
    );
  }

  /**
   * Get message history with a friend
   * GET /me/friends/:friendId/messages
   */
  @Get("me/friends/:friendId/messages")
  async getMessageHistory(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const pagination = PaginationSchema.parse(query);
    return this.friendService.getMessageHistory(userId, friendId, pagination.limit, pagination.cursor);
  }

  /**
   * Active gifts for messaging UI (authenticated; send amounts are in diamonds and must match validateGift).
   * Does not return legacy per-gift `coins` — coin→diamond applies only when purchasing diamonds.
   * GET /me/gifts/catalog
   */
  @Get("me/gifts/catalog")
  async getGiftCatalog(@Headers("authorization") authz: string) {
    const token = this.getTokenFromHeader(authz);
    await this.verifyTokenAndGetUserId(token!);
    const rows = await this.giftCatalogService.getAllActiveGifts();
    const firstMessageCostCoins = parseInt(process.env.FIRST_MESSAGE_COST_COINS || "10", 10);
    return {
      firstMessageCostCoins,
      gifts: rows.map((g: any) => ({
        giftId: g.giftId,
        name: g.name,
        emoji: g.emoji,
        diamonds: g.diamonds ?? g.coins ?? 0,
        imageUrl: resolveGiftStickerUrl(g.imageUrl, g.giftId)
      }))
    };
  }

  /**
   * Check if the current user is friends with another user (e.g. video chat UI).
   * GET /me/friends/:friendId/check
   * Gateway: GET /v1/friends/me/friends/:friendId/check
   */
  @Get("me/friends/:friendId/check")
  async checkFriendshipWithUser(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const areFriends = await this.friendService.areFriends(userId, friendId);
    return { areFriends };
  }

  /**
   * Get inbox conversations
   * GET /me/conversations/inbox?filter=text_only|with_gift|only_follows
   */
  @UseGuards(ConversationRateLimitGuard)
  @Get("me/conversations/inbox")
  async getInboxConversations(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    // Auto-mark INBOX section as seen
    await this.friendService.markSectionAsSeen(userId, "INBOX");
    const parsed = ConversationQuerySchema.parse(query);
    return this.friendService.getInboxConversations(
      userId,
      parsed.limit,
      parsed.cursor,
      parsed.filter
    );
  }

  /**
   * Get received requests conversations
   * GET /me/conversations/received-requests?filter=text_only|with_gift|only_follows
   */
  @UseGuards(ConversationRateLimitGuard)
  @Get("me/conversations/received-requests")
  async getReceivedRequestsConversations(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    // Auto-mark RECEIVED_REQUESTS section as seen
    await this.friendService.markSectionAsSeen(userId, "RECEIVED_REQUESTS");
    const parsed = ConversationQuerySchema.parse(query);
    return this.friendService.getReceivedRequestsConversations(
      userId,
      parsed.limit,
      parsed.cursor,
      parsed.filter
    );
  }

  /**
   * Get sent requests conversations
   * GET /me/conversations/sent-requests?filter=text_only|with_gift|only_follows
   */
  @UseGuards(ConversationRateLimitGuard)
  @Get("me/conversations/sent-requests")
  async getSentRequestsConversations(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    // Auto-mark SENT_REQUESTS section as seen
    await this.friendService.markSectionAsSeen(userId, "SENT_REQUESTS");
    const parsed = ConversationQuerySchema.parse(query);
    return this.friendService.getSentRequestsConversations(
      userId,
      parsed.limit,
      parsed.cursor,
      parsed.filter
    );
  }

  /**
   * Send message via conversation ID
   * POST /me/conversations/:conversationId/messages
   */
  @Post("me/conversations/:conversationId/messages")
  @UseGuards(RateLimitGuard)
  async sendMessageToConversation(
    @Headers("authorization") authz: string,
    @Param("conversationId") conversationId: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const dto = parseOrBadRequest(SendMessageSchema, body);
    return this.friendService.sendMessageToConversation(
      userId,
      conversationId,
      dto.message || null,
      dto.giftId,
      dto.giftAmount,
      dto.gif
    );
  }

  /**
   * Search GIFs (GIPHY)
   * GET /me/gifs/search?q=hello&limit=25&offset=0&rating=g
   */
  @Get("me/gifs/search")
  async searchGifs(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    await this.verifyTokenAndGetUserId(token!);

    const parsed = parseOrBadRequest(z.object({
      q: z.string().min(1, "q is required"),
      limit: z.string().optional(),
      offset: z.string().optional(),
      rating: z.string().optional()
    }), query);

    const limit = Math.min(Math.max(parseInt(parsed.limit ?? "25", 10) || 25, 1), 50);
    const offset = Math.max(parseInt(parsed.offset ?? "0", 10) || 0, 0);
    const rating = parsed.rating?.trim() || undefined;

    return this.giphy.search(parsed.q, { limit, offset, rating });
  }

  /**
   * Trending GIFs (GIPHY) — frontend: GET /v1/friends/me/gifs/trending
   */
  @Get("me/gifs/trending")
  async trendingGifs(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    await this.verifyTokenAndGetUserId(token!);

    const parsed = parseOrBadRequest(z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
      rating: z.string().optional()
    }), query);

    const limit = Math.min(Math.max(parseInt(parsed.limit ?? "25", 10) || 25, 1), 50);
    const offset = Math.max(parseInt(parsed.offset ?? "0", 10) || 0, 0);
    const rating = parsed.rating?.trim() || undefined;

    return this.giphy.trending({ limit, offset, rating });
  }

  /**
   * Alias for GIPHY trending (frontend compatibility)
   */
  @Get("me/giphy/trending")
  async trendingGifsGiphyAlias(
    @Headers("authorization") authz: string,
    @Query() query: any
  ) {
    return this.trendingGifs(authz, query);
  }

  /**
   * Get messages for a conversation
   * GET /me/conversations/:conversationId/messages
   */
  @Get("me/conversations/:conversationId/messages")
  async getConversationMessages(
    @Headers("authorization") authz: string,
    @Param("conversationId") conversationId: string,
    @Query() query: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const pagination = PaginationSchema.parse(query);
    return this.friendService.getConversationMessages(userId, conversationId, pagination.limit, pagination.cursor);
  }

  /**
   * Get notification counts
   * GET /me/notifications/count
   */
  @Get("me/notifications/count")
  @UseGuards(NotificationRateLimitGuard)
  async getNotificationCounts(@Headers("authorization") authz?: string) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    return this.friendService.getNotificationCounts(userId);
  }

  /**
   * Mark section as seen
   * POST /me/notifications/mark-seen
   */
  @Post("me/notifications/mark-seen")
  async markSectionAsSeen(
    @Headers("authorization") authz: string,
    @Body() body: any
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    const sectionSchema = z.enum(["INBOX", "RECEIVED_REQUESTS", "SENT_REQUESTS", "FRIEND_REQUESTS"]);
    const { section } = z.object({ section: sectionSchema }).parse(body);
    const result = await this.friendService.markSectionAsSeen(userId, section);
    return {
      ok: true,
      section,
      lastSeenAt: result.lastSeenAt.toISOString()
    };
  }

  /**
   * Mark messages as read
   * POST /me/friends/:friendId/messages/read
   */
  @Post("me/friends/:friendId/messages/read")
  async markMessagesAsRead(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.markMessagesAsRead(userId, friendId);
    return { ok: true };
  }

  /**
   * Unfriend a user
   * POST /me/friends/:friendId/unfriend
   */
  @Post("me/friends/:friendId/unfriend")
  async unfriend(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.unfriend(userId, friendId);
    return { ok: true };
  }

  /**
   * Block a user
   * POST /me/friends/:friendId/block
   */
  @Post("me/friends/:friendId/block")
  async blockUser(
    @Headers("authorization") authz: string,
    @Param("friendId") friendId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    const userId = await this.verifyTokenAndGetUserId(token!);
    await this.friendService.blockUser(userId, friendId);
    return { ok: true };
  }

  /**
   * Get service metrics (for monitoring)
   * GET /internal/metrics
   */
  @Get("internal/metrics")
  async getMetrics(@Headers("x-service-token") serviceToken?: string) {
    // Optional: Add service token validation for production
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (expectedToken && serviceToken !== expectedToken) {
      throw new HttpException("Invalid service token", HttpStatus.UNAUTHORIZED);
    }

    return this.friendService.getMetrics();
  }

  /* ---------- Internal/Service Endpoints (No Auth Required) ---------- */

  /**
   * Send friend request during call (called by streaming-service)
   * POST /internal/friends/requests
   * Requires service authentication token
   */
  @Post("internal/friends/requests")
  async sendFriendRequestDuringCall(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Body() body: any
  ) {
    // Verify service token for internal endpoint security
    // In test mode, allow requests without token
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (serviceToken !== expectedToken) {
        throw new HttpException(
          "Invalid service token",
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const { fromUserId, toUserId } = z.object({
      fromUserId: z.string(),
      toUserId: z.string(),
      roomId: z.string().optional()
    }).parse(body);

    const result = await this.friendService.sendFriendRequest(fromUserId, toUserId);
    return {
      ok: true,
      requestId: result.requestId,
      autoAccepted: result.autoAccepted
    };
  }

  /**
   * Check if two users are friends (internal endpoint)
   * GET /internal/friends/check?userId1=xxx&userId2=xxx
   */
  @Get("internal/friends/check")
  async checkFriendship(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Query() query: any
  ) {
    this.verifyInternalServiceToken(serviceToken);
    const { userId1, userId2 } = z.object({
      userId1: z.string(),
      userId2: z.string()
    }).parse(query);

    // Check friendship using friend service method
    const areFriends = await this.friendService.areFriends(userId1, userId2);

    return {
      areFriends
    };
  }

  /**
   * Get relationship for History Hotline (internal)
   * GET /internal/friends/relationship?userId=xxx&otherUserId=xxx
   */
  @Get("internal/friends/relationship")
  async getRelationship(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Query() query: any
  ) {
    this.verifyInternalServiceToken(serviceToken);
    const { userId, otherUserId } = z
      .object({ userId: z.string(), otherUserId: z.string() })
      .parse(query);
    return this.friendService.getRelationship(userId, otherUserId);
  }

  /**
   * Get relationships batch for History (internal)
   * POST /internal/friends/relationships
   * Body: { userId: string, otherUserIds: string[] }
   */
  @Post("internal/friends/relationships")
  async getRelationshipsBatch(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Body() body: any
  ) {
    this.verifyInternalServiceToken(serviceToken);
    const { userId, otherUserIds } = z
      .object({
        userId: z.string(),
        otherUserIds: z.array(z.string())
      })
      .parse(body);
    const map = await this.friendService.getRelationshipsBatch(userId, otherUserIds);
    return Object.fromEntries(map);
  }

  /* ---------- Test Endpoints (No Auth Required) ---------- */

  /**
   * Test endpoint: Get friends (bypasses auth)
   * GET /test/friends?userId=xxx&limit=50&cursor=xxx
   */
  @Get("test/friends")
  async getFriendsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const cursor = query.cursor;
    return this.friendService.getFriends(userId, limit, cursor);
  }

  /**
   * Test endpoint: Get pending requests (bypasses auth)
   * GET /test/friends/requests/pending?userId=xxx
   */
  @Get("test/friends/requests/pending")
  async getPendingRequestsTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    return this.friendService.getPendingRequests(userId);
  }

  /**
   * Test endpoint: Get sent requests (bypasses auth)
   * GET /test/friends/requests/sent?userId=xxx
   */
  @Get("test/friends/requests/sent")
  async getSentRequestsTest(@Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    return this.friendService.getSentRequests(userId);
  }

  /**
   * Test endpoint: Send friend request (bypasses auth)
   * POST /test/friends/requests
   */
  @Post("test/friends/requests")
  async sendFriendRequestTest(@Body() body: any) {
    const { fromUserId, toUserId } = z.object({
      fromUserId: z.string(),
      toUserId: z.string()
    }).parse(body);
    const result = await this.friendService.sendFriendRequest(fromUserId, toUserId);
    return {
      ok: true,
      requestId: result.requestId,
      autoAccepted: result.autoAccepted
    };
  }

  /**
   * Test endpoint: Accept friend request (bypasses auth)
   * POST /test/friends/requests/:requestId/accept
   */
  @Post("test/friends/requests/:requestId/accept")
  async acceptRequestTest(@Param("requestId") requestId: string, @Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    await this.friendService.acceptFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Test endpoint: Reject friend request (bypasses auth)
   * POST /test/friends/requests/:requestId/reject
   */
  @Post("test/friends/requests/:requestId/reject")
  async rejectRequestTest(@Param("requestId") requestId: string, @Query("userId") userId: string) {
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    await this.friendService.rejectFriendRequest(requestId, userId);
    return { ok: true };
  }

  /**
   * Auto-create friendship (internal endpoint - for external users accepting squad invites)
   * POST /internal/friends/auto-create
   */
  @Post("internal/friends/auto-create")
  async autoCreateFriendship(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Body() body: any
  ) {
    // Verify service token
    // In test mode, allow requests without token
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (serviceToken !== expectedToken) {
        throw new HttpException(
          "Invalid service token",
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const { userId1, userId2 } = z.object({
      userId1: z.string(),
      userId2: z.string()
    }).parse(body);

    // Auto-create friendship directly
    try {
      await this.friendService.autoCreateFriendship(userId1, userId2);
      return {
        ok: true,
        message: "Friendship created successfully"
      };
    } catch (error: any) {
      // If already friends, return success
      if (error.message?.includes("already friends")) {
        return {
          ok: true,
          message: "Users are already friends"
        };
      }
      throw error;
    }
  }

  /**
   * Get friends list (internal endpoint)
   * GET /internal/friends?userId=xxx&limit=50
   */
  @Get("internal/friends")
  async getFriendsInternal(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Query() query: any
  ) {
    // Verify service token
    // In test mode, allow requests without token
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (serviceToken !== expectedToken) {
        throw new HttpException(
          "Invalid service token",
          HttpStatus.UNAUTHORIZED
        );
      }
    }

    const { userId, limit } = z.object({
      userId: z.string(),
      limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 50)
    }).parse(query);

    const result = await this.friendService.getFriends(userId, limit || 50);

    return {
      friends: result.friends
    };
  }

  /**
   * Record squad invite / outcome in friend inbox (internal — discovery-service)
   * POST /internal/messages/squad
   */
  @Post("internal/messages/squad")
  async recordSquadInboxMessage(
    @Headers("x-service-token") serviceToken: string | undefined,
    @Body() body: unknown
  ) {
    const isTestMode = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "true";
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

    if (!isTestMode) {
      if (!expectedToken) {
        throw new HttpException(
          "Internal service token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      if (serviceToken !== expectedToken) {
        throw new HttpException("Invalid service token", HttpStatus.UNAUTHORIZED);
      }
    }

    const SquadInboxBodySchema = z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("invite"),
        inviterId: z.string(),
        inviteeId: z.string(),
        invitationId: z.string()
      }),
      z.object({
        kind: z.literal("outcome"),
        inviterId: z.string(),
        inviteeId: z.string(),
        invitationId: z.string(),
        outcome: z.enum(["accepted", "rejected"])
      })
    ]);

    const parsed = SquadInboxBodySchema.parse(body);

    if (parsed.kind === "invite") {
      const r = await this.friendService.internalSendSquadInvite({
        inviterId: parsed.inviterId,
        inviteeId: parsed.inviteeId,
        invitationId: parsed.invitationId
      });
      return { ok: true, messageId: r.messageId };
    }

    const r = await this.friendService.internalSendSquadOutcome({
      inviterId: parsed.inviterId,
      inviteeId: parsed.inviteeId,
      invitationId: parsed.invitationId,
      outcome: parsed.outcome
    });
    return { ok: true, messageId: r.messageId };
  }

  /* ---------- Test Endpoints for Messaging (No Auth Required) ---------- */

  /**
   * Test endpoint: Get inbox conversations (bypasses auth)
   * GET /test/conversations/inbox?userId=xxx&limit=50&cursor=xxx
   */
  @Get("test/conversations/inbox")
  async getInboxConversationsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    return this.friendService.getInboxConversations(userId, limit, cursor);
  }

  /**
   * Test endpoint: Get received requests conversations (bypasses auth)
   * GET /test/conversations/received-requests?userId=xxx&limit=50&cursor=xxx&filter=text_only|with_gift|only_follows
   */
  @Get("test/conversations/received-requests")
  async getReceivedRequestsConversationsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    const filter = query.filter;
    return this.friendService.getReceivedRequestsConversations(userId, limit, cursor, filter);
  }

  /**
   * Test endpoint: Get sent requests conversations (bypasses auth)
   * GET /test/conversations/sent-requests?userId=xxx&limit=50&cursor=xxx&filter=text_only|with_gift|only_follows
   */
  @Get("test/conversations/sent-requests")
  async getSentRequestsConversationsTest(@Query() query: any) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    const filter = query.filter;
    return this.friendService.getSentRequestsConversations(userId, limit, cursor, filter);
  }

  /**
   * Test endpoint: Send message to friend request (bypasses auth)
   * POST /test/friends/requests/:requestId/messages?fromUserId=xxx
   */
  @Post("test/friends/requests/:requestId/messages")
  async sendMessageToNonFriendTest(
    @Param("requestId") requestId: string,
    @Query("fromUserId") fromUserId: string,
    @Body() body: any
  ) {
    if (!fromUserId) {
      throw new HttpException("fromUserId is required", HttpStatus.BAD_REQUEST);
    }
    const request = await this.friendService.getRequest(requestId);
    const dto = SendMessageSchema.parse(body);
    return this.friendService.sendMessageToNonFriend(
      fromUserId,
      request.toUserId,
      dto.message || null,
      requestId,
      dto.giftId,
      dto.giftAmount,
      dto.gif
    );
  }

  /**
   * Test endpoint: Send message to friend (bypasses auth)
   * POST /test/friends/:friendId/messages?fromUserId=xxx
   */
  @Post("test/friends/:friendId/messages")
  async sendMessageToFriendTest(
    @Param("friendId") friendId: string,
    @Query("fromUserId") fromUserId: string,
    @Body() body: any
  ) {
    if (!fromUserId) {
      throw new HttpException("fromUserId is required", HttpStatus.BAD_REQUEST);
    }
    const dto = SendMessageSchema.parse(body);
    return this.friendService.sendMessageToFriend(
      fromUserId,
      friendId,
      dto.message || null,
      dto.giftId,
      dto.giftAmount,
      dto.gif
    );
  }

  /**
   * Test endpoint: Get conversation messages (bypasses auth)
   * GET /test/conversations/:conversationId/messages?userId=xxx&limit=50&cursor=xxx
   */
  @Get("test/conversations/:conversationId/messages")
  async getConversationMessagesTest(
    @Param("conversationId") conversationId: string,
    @Query() query: any
  ) {
    const userId = query.userId;
    if (!userId) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 50;
    const cursor = query.cursor;
    return this.friendService.getConversationMessages(userId, conversationId, limit, cursor);
  }
}
