import { Controller, Get, Post, Param, Body, BadRequestException } from "@nestjs/common";
import { RoomService } from "../services/room.service.js";
import { ChatService } from "../services/chat.service.js";
import { z } from "zod";

// Simple auth guard (you can enhance this later)
const createRoomSchema = z.object({
  userIds: z.array(z.string()).min(2).max(4),
  callType: z.enum(["matched", "squad"]).optional().default("matched")
});

@Controller("streaming")
export class StreamingController {
  constructor(
    private roomService: RoomService,
    private chatService: ChatService
  ) {}

  /**
   * Create a room (typically called when users enter IN_SQUAD)
   * POST /streaming/rooms
   */
  @Post("rooms")
  async createRoom(@Body() body: unknown) {
    try {
      const { userIds, callType } = createRoomSchema.parse(body);
      return await this.roomService.createRoom(userIds, callType);
    } catch (error: any) {
      // Re-throw BadRequestException to let the filter handle it
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Get room info
   * GET /streaming/rooms/:roomId
   */
  @Get("rooms/:roomId")
  async getRoom(@Param("roomId") roomId: string) {
    const details = await this.roomService.getRoomDetails(roomId);
    if (!details) {
      return { exists: false };
    }
    return { exists: true, ...details };
  }

  /**
   * Get chat history
   * GET /streaming/rooms/:roomId/chat
   */
  @Get("rooms/:roomId/chat")
  async getChatHistory(@Param("roomId") roomId: string) {
    try {
      return await this.chatService.getChatHistory(roomId);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        throw new BadRequestException(`Room ${roomId} not found`);
      }
      throw error;
    }
  }

  /**
   * Get room info for a user
   * GET /streaming/users/:userId/room
   */
  @Get("users/:userId/room")
  async getUserRoom(@Param("userId") userId: string) {
    // Check if user is a participant in any active room
    const participantRoom = await this.roomService.getUserActiveRoom(userId);
    
    if (participantRoom) {
      try {
        const roomDetails = await this.roomService.getRoomDetails(participantRoom.roomId);
        
        if (!roomDetails) {
          return { exists: false };
        }
        
        // Find the user's specific role (HOST or PARTICIPANT)
        const userParticipant = roomDetails.participants.find(p => p.userId === userId);
        const userRole = userParticipant?.role || 'PARTICIPANT';
        
        return {
          exists: true,
          role: 'participant',
          userRole: userRole, // 'HOST' or 'PARTICIPANT'
          ...roomDetails
        };
      } catch (error: any) {
        // Room might have been ended between query and details fetch
        return { exists: false };
      }
    }
    
    // Check if user is a viewer in any active room
    const viewerRoom = await this.roomService.getUserActiveRoomAsViewer(userId);
    if (viewerRoom) {
      try {
        const roomDetails = await this.roomService.getRoomDetails(viewerRoom.roomId);
        
        if (!roomDetails) {
          return { exists: false };
        }
        
        return {
          exists: true,
          role: 'viewer',
          userRole: 'VIEWER',
          ...roomDetails
        };
      } catch (error: any) {
        // Room might have been ended between query and details fetch
        return { exists: false };
      }
    }
    
    return { exists: false };
  }
}

