import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RoomService } from "./room.service.js";
import { DiscoveryClientService } from "./discovery-client.service.js";

@Injectable()
export class FavouriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomService: RoomService,
    private readonly discoveryClient: DiscoveryClientService
  ) {}

  /**
   * Add a participant/broadcaster to the user's favourites (idempotent).
   */
  async addFavourite(userId: string, targetUserId: string): Promise<void> {
    if (userId === targetUserId) {
      throw new BadRequestException("Cannot favourite yourself");
    }
    await this.prisma.userFavouriteBroadcaster.upsert({
      where: {
        userId_targetUserId: { userId, targetUserId }
      },
      create: { userId, targetUserId },
      update: {}
    });
  }

  /**
   * Remove a participant/broadcaster from the user's favourites.
   */
  async removeFavourite(userId: string, targetUserId: string): Promise<void> {
    await this.prisma.userFavouriteBroadcaster.deleteMany({
      where: { userId, targetUserId }
    });
  }

  /**
   * Get the list of target user IDs the user has favourited (for internal use).
   */
  async getFavouriteUserIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.userFavouriteBroadcaster.findMany({
      where: { userId },
      select: { targetUserId: true }
    });
    return rows.map((r) => r.targetUserId);
  }

  /**
   * Get favourite users who are currently broadcasting (same shape as getActiveBroadcasts).
   */
  async getFavouriteBroadcasters(
    userId: string,
    limit: number = 20
  ): Promise<{
    broadcasts: Array<{
      roomId: string;
      participantCount: number;
      viewerCount: number;
      participants: Array<{
        userId: string;
        role: string;
        joinedAt: Date;
        username?: string | null;
        displayPictureUrl?: string | null;
        age?: number | null;
      }>;
      startedAt: Date | null;
      createdAt: Date;
      broadcastTitle?: string | null;
      broadcastDescription?: string | null;
      broadcastTags?: string[];
      isTrending?: boolean;
      popularityScore?: number;
    }>;
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const targetUserIds = await this.getFavouriteUserIds(userId);
    if (targetUserIds.length === 0) {
      return { broadcasts: [], hasMore: false };
    }
    return this.roomService.getActiveBroadcasts({
      filter: { participantUserIds: targetUserIds },
      limit,
      offset: 0
    });
  }

  /**
   * Get all favourite broadcasters with live/offline status for Beam TV shortcut strip.
   */
  async getAllFavouritesWithLiveStatus(
    userId: string,
    limit: number = 100
  ): Promise<{
    favourites: Array<{
      userId: string;
      username?: string | null;
      displayPictureUrl?: string | null;
      age?: number | null;
      isLive: boolean;
      liveRoomId?: string;
    }>;
  }> {
    const rows = await this.prisma.userFavouriteBroadcaster.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { targetUserId: true }
    });

    const favouriteUserIds = rows.map((r) => r.targetUserId);
    if (favouriteUserIds.length === 0) {
      return { favourites: [] };
    }

    const [profiles, activeFavouriteBroadcasts] = await Promise.all([
      this.discoveryClient.getUserProfilesBatch(favouriteUserIds),
      this.roomService.getActiveBroadcasts({
        filter: { participantUserIds: favouriteUserIds },
        limit: 200,
        offset: 0
      })
    ]);

    const liveRoomByUserId = new Map<string, string>();
    for (const b of activeFavouriteBroadcasts.broadcasts) {
      for (const p of b.participants) {
        if (favouriteUserIds.includes(p.userId) && !liveRoomByUserId.has(p.userId)) {
          liveRoomByUserId.set(p.userId, b.roomId);
        }
      }
    }

    const favourites = favouriteUserIds.map((id) => {
      const profile = profiles.get(id);
      const liveRoomId = liveRoomByUserId.get(id);
      return {
        userId: id,
        username: profile?.username || null,
        displayPictureUrl: profile?.displayPictureUrl || null,
        age: profile?.age ?? null,
        isLive: Boolean(liveRoomId),
        liveRoomId
      };
    });

    return { favourites };
  }
}
