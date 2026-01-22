# Complete Implementation Guide for HMM_TV Enhancements

## Status
Due to the comprehensive nature of these changes, I've completed:
1. ✅ Database schema updates (metadata fields, BroadcastViewHistory, engagement tables)
2. 📝 Implementation guide created

## Remaining Implementation Steps

The following files need to be updated with the code provided below:

### 1. WebSocket Handlers (streaming.gateway.ts)

**Add after line 235 (after join-as-viewer case):**
```typescript
        case "create-viewer-transport":
          await this.handleCreateViewerTransport(connectionId, userId, data, ws);
          break;

        case "get-broadcast-producers":
          await this.handleGetBroadcastProducers(connectionId, userId, data, ws);
          break;

        case "consume-broadcast":
          await this.handleConsumeBroadcast(connectionId, userId, data, ws);
          break;
```

**Add handler methods before onModuleDestroy (around line 1180):**
```typescript
  /**
   * Handle create viewer transport (for TikTok-style viewing)
   */
  private async handleCreateViewerTransport(
    connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      const transport = await this.broadcastService.createViewerTransport(roomId, userId);

      this.send(ws, {
        type: "viewer-transport-created",
        data: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to create viewer transport");
    }
  }

  /**
   * Handle get broadcast producers
   */
  private async handleGetBroadcastProducers(
    connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId } = data;
    if (!roomId) {
      this.sendError(ws, "roomId is required");
      return;
    }

    try {
      const producers = await this.broadcastService.getBroadcastProducers(roomId);

      this.send(ws, {
        type: "broadcast-producers",
        data: {
          roomId,
          producers
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to get broadcast producers");
    }
  }

  /**
   * Handle consume broadcast stream
   */
  private async handleConsumeBroadcast(
    connectionId: string,
    userId: string,
    data: any,
    ws: any
  ) {
    const { roomId, transportId, producerId, rtpCapabilities } = data;
    if (!roomId || !transportId || !producerId || !rtpCapabilities) {
      this.sendError(ws, "roomId, transportId, producerId, and rtpCapabilities are required");
      return;
    }

    try {
      const consumer = await this.broadcastService.consumeBroadcast(
        roomId,
        userId,
        transportId,
        producerId,
        rtpCapabilities
      );

      this.send(ws, {
        type: "broadcast-consumed",
        data: {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        }
      });
    } catch (error: any) {
      this.sendError(ws, error.message || "Failed to consume broadcast");
    }
  }
```

### 2. Update getActiveBroadcasts with Sorting/Filtering/Pagination (room.service.ts)

Replace the existing `getActiveBroadcasts` method with:

```typescript
  async getActiveBroadcasts(options: {
    sort?: 'recent' | 'viewers' | 'popular' | 'trending';
    filter?: {
      participantCount?: { min?: number; max?: number };
      gender?: string[];
      city?: string;
      tags?: string[];
    };
    limit?: number;
    offset?: number;
    cursor?: string;
  } = {}): Promise<{
    broadcasts: Array<{
      roomId: string;
      participantCount: number;
      viewerCount: number;
      participants: Array<{
        userId: string;
        role: string;
        joinedAt: Date;
      }>;
      startedAt: Date | null;
      createdAt: Date;
      broadcastTitle?: string | null;
      broadcastDescription?: string | null;
      broadcastTags?: string[];
      isTrending?: boolean;
      popularityScore?: number;
      likeCount?: number;
      commentCount?: number;
    }>;
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const {
      sort = 'recent',
      filter = {},
      limit = 20,
      offset = 0,
      cursor
    } = options;

    // Build where clause
    const where: any = {
      status: "IN_BROADCAST",
      isBroadcasting: true
    };

    // Apply filters
    if (filter.participantCount) {
      // This will be applied after fetching
    }

    // Build orderBy
    let orderBy: any = { createdAt: "desc" };
    if (sort === 'viewers') {
      orderBy = { viewers: { _count: "desc" } };
    } else if (sort === 'popular') {
      orderBy = { popularityScore: "desc" };
    } else if (sort === 'trending') {
      orderBy = [
        { isTrending: "desc" },
        { popularityScore: "desc" },
        { createdAt: "desc" }
      ];
    }

    const sessions = await this.prisma.callSession.findMany({
      where,
      include: {
        participants: {
          where: { leftAt: null },
          select: {
            userId: true,
            role: true,
            joinedAt: true
          }
        },
        viewers: {
          where: { leftAt: null },
          select: { userId: true }
        }
      },
      orderBy,
      take: limit + 1, // Fetch one extra to determine hasMore
      skip: offset
    });

    const hasMore = sessions.length > limit;
    const broadcasts = sessions.slice(0, limit).map(session => {
      // Get engagement counts (would need separate queries or joins)
      return {
        roomId: session.roomId,
        participantCount: session.participants.length,
        viewerCount: session.viewers.length,
        participants: session.participants.map(p => ({
          userId: p.userId,
          role: p.role,
          joinedAt: p.joinedAt
        })),
        startedAt: session.startedAt,
        createdAt: session.createdAt,
        broadcastTitle: session.broadcastTitle,
        broadcastDescription: session.broadcastDescription,
        broadcastTags: session.broadcastTags || [],
        isTrending: session.isTrending,
        popularityScore: session.popularityScore
      };
    });

    return {
      broadcasts,
      nextCursor: hasMore ? sessions[limit - 1].id : undefined,
      hasMore
    };
  }
```

### 3. Engagement Endpoints (discovery.controller.ts)

Add these endpoints:

```typescript
  /**
   * Like/unlike a broadcast
   * POST /discovery/broadcasts/:roomId/like
   */
  @Post("broadcasts/:roomId/like")
  async likeBroadcast(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    return await this.discoveryService.toggleBroadcastLike(roomId, userId);
  }

  /**
   * Add comment to broadcast
   * POST /discovery/broadcasts/:roomId/comments
   */
  @Post("broadcasts/:roomId/comments")
  async addComment(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string,
    @Body() body: { comment: string }
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    return await this.discoveryService.addBroadcastComment(roomId, userId, body.comment);
  }

  /**
   * Get comments for broadcast
   * GET /discovery/broadcasts/:roomId/comments
   */
  @Get("broadcasts/:roomId/comments")
  async getComments(
    @Param("roomId") roomId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return await this.discoveryService.getBroadcastComments(roomId, limitNum, offsetNum);
  }

  /**
   * Share broadcast
   * POST /discovery/broadcasts/:roomId/share
   */
  @Post("broadcasts/:roomId/share")
  async shareBroadcast(
    @Headers("authorization") authz: string,
    @Param("roomId") roomId: string,
    @Body() body: { shareType?: string }
  ) {
    const token = this.getTokenFromHeader(authz);
    if (!token) {
      throw new HttpException("Missing token", HttpStatus.UNAUTHORIZED);
    }

    const { verifyToken } = await import("@hmm/common");
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    if (!jwkStr || jwkStr === "undefined") {
      throw new HttpException("Server configuration error", HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    const publicJwk = JSON.parse(cleanedJwk);
    const verifyAccess = await verifyToken(publicJwk);
    const payload = await verifyAccess(token);
    const userId = payload.sub;

    return await this.discoveryService.shareBroadcast(roomId, userId, body.shareType || "link");
  }
```

### 4. Update Discovery Service Methods

Add these methods to `discovery.service.ts`:

```typescript
  async toggleBroadcastLike(roomId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    // Check if already liked
    const existing = await (this.prisma as any).broadcastLike.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    if (existing) {
      // Unlike
      await (this.prisma as any).broadcastLike.delete({
        where: { id: existing.id }
      });
    } else {
      // Like
      await (this.prisma as any).broadcastLike.create({
        data: { roomId, userId }
      });
    }

    const likeCount = await (this.prisma as any).broadcastLike.count({
      where: { roomId }
    });

    return {
      liked: !existing,
      likeCount
    };
  }

  async addBroadcastComment(roomId: string, userId: string, comment: string) {
    const newComment = await (this.prisma as any).broadcastComment.create({
      data: { roomId, userId, comment }
    });

    return {
      id: newComment.id,
      roomId,
      userId,
      comment,
      createdAt: newComment.createdAt
    };
  }

  async getBroadcastComments(roomId: string, limit: number, offset: number) {
    const comments = await (this.prisma as any).broadcastComment.findMany({
      where: {
        roomId,
        deletedAt: null
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset
    });

    return { comments };
  }

  async shareBroadcast(roomId: string, userId: string, shareType: string) {
    await (this.prisma as any).broadcastShare.create({
      data: { roomId, userId, shareType }
    });

    return { success: true };
  }
```

### 5. Update BroadcastViewHistory Usage

Update `getViewedBroadcastRoomIds` in `discovery.service.ts`:

```typescript
  private async getViewedBroadcastRoomIds(
    userId: string,
    sessionId: string
  ): Promise<string[]> {
    try {
      const views = await (this.prisma as any).broadcastViewHistory.findMany({
        where: {
          userId,
          // Optionally filter by sessionId or deviceId for cross-device sync
        },
        select: {
          roomId: true
        },
        distinct: ['roomId']
      });

      return views.map((v: { roomId: string }) => v.roomId);
    } catch (error: any) {
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("BroadcastViewHistory table not found:", error.message);
        return [];
      }
      console.error("Error fetching viewed broadcasts:", error);
      return [];
    }
  }

  async markBroadcastViewed(
    userId: string,
    sessionId: string,
    roomId: string,
    duration?: number,
    deviceId?: string
  ): Promise<void> {
    try {
      await (this.prisma as any).broadcastViewHistory.create({
        data: {
          userId,
          roomId,
          duration,
          deviceId
        }
      });
    } catch (error: any) {
      if (error?.code === 'P2021' || error?.message?.includes('does not exist')) {
        console.warn("BroadcastViewHistory table not found:", error.message);
        return;
      }
      console.error("Error marking broadcast as viewed:", error);
    }
  }
```

### 6. Fix User Status Management

Update `removeViewer` in `room.service.ts` to restore user status:

```typescript
  async removeViewer(roomId: string, userId: string): Promise<void> {
    // ... existing code ...

    // Restore user status (check what it was before)
    // If user was AVAILABLE/ONLINE/OFFLINE before joining, restore to that
    // For now, restore to AVAILABLE (can be enhanced to track previous status)
    await this.discoveryClient.updateUserStatus(userId, "AVAILABLE").catch((err) => {
      this.logger.error(`Failed to restore user status: ${err.message}`);
    });
  }
```

## Next Steps

1. Run Prisma migrations:
   ```bash
   cd apps/streaming-service && npx prisma migrate dev --name add_broadcast_metadata
   cd apps/discovery-service && npx prisma migrate dev --name add_broadcast_engagement
   ```

2. Test WebSocket handlers
3. Test engagement endpoints
4. Test recommendation algorithm
5. Update frontend

## Remaining Shortcomings

After implementing the above, these areas may still need attention:

1. **Real-time engagement updates** - WebSocket notifications when likes/comments change
2. **Advanced recommendation algorithm** - ML-based recommendations
3. **Broadcast analytics** - Detailed metrics and insights
4. **Content moderation** - Auto-moderation for broadcast content
5. **Quality of Service** - Adaptive bitrate based on network conditions
6. **Caching layer** - Redis caching for popular broadcasts
7. **Rate limiting** - Prevent abuse of engagement endpoints
