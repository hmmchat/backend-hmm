import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post
} from "@nestjs/common";
import { z } from "zod";
import { RoomService } from "../services/room.service.js";

/**
 * Dashboard Beam TV moderation tools (routed via /v1/streaming/admin/...).
 */
@Controller("streaming/admin/broadcasts")
export class BroadcastModerationAdminController {
  constructor(private readonly roomService: RoomService) {}

  /**
   * Resolve active Beam TV room for a broadcast participant (not a viewer).
   * GET /streaming/admin/broadcasts/by-participant/:userId
   */
  @Get("by-participant/:userId")
  async byParticipant(@Param("userId") userId: string) {
    const id = String(userId || "").trim();
    if (!id) {
      throw new HttpException("userId is required", HttpStatus.BAD_REQUEST);
    }
    const room = await this.roomService.getActiveBroadcastByParticipantUserId(id);
    if (!room) {
      return { ok: true, found: false, room: null };
    }
    return { ok: true, found: true, room };
  }

  /**
   * Force-end a Beam TV / call room for everyone with a custom message.
   * POST /streaming/admin/broadcasts/:roomId/end
   * Body: { message: string, endedBy?: string }
   */
  @Post(":roomId/end")
  async endBroadcast(
    @Param("roomId") roomId: string,
    @Body() body: unknown
  ) {
    const parsed = z
      .object({
        message: z.string().trim().min(1).max(2000),
        endedBy: z.string().trim().optional()
      })
      .parse(body ?? {});

    const exists = await this.roomService.roomExists(roomId);
    if (!exists) {
      throw new HttpException("Room not found", HttpStatus.NOT_FOUND);
    }

    await this.roomService.endRoom(roomId, {
      message: parsed.message,
      reason: "moderator_stop",
      endedBy: parsed.endedBy
    });

    return {
      ok: true,
      roomId,
      ended: true,
      message: parsed.message
    };
  }
}
