import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { RoomService } from "./room.service.js";

@Injectable()
export class FavouriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomService: RoomService
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
}
