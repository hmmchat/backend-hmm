import { Controller, Get, Post, Delete, Param, Body, Query } from "@nestjs/common";
import { DareService } from "../services/dare.service.js";
import { z } from "zod";

const viewDareSchema = z.object({
  dareId: z.string(),
  userId: z.string()
});

const assignDareSchema = z.object({
  assignedToUserId: z.string(),
  dareId: z.string(),
  userId: z.string()
});

const sendDareSchema = z.object({
  dareId: z.string(),
  giftId: z.string(),
  userId: z.string()
});


const performDareSchema = z.object({
  performedBy: z.string()
});

@Controller("streaming/rooms/:roomId/dares")
export class DareController {
  constructor(private dareService: DareService) {}

  /**
   * Get list of available dares
   * GET /streaming/rooms/:roomId/dares
   */
  @Get()
  getDareList() {
    return { dares: this.dareService.getDareList() };
  }

  /**
   * Get list of available gifts with diamond costs
   * GET /streaming/rooms/:roomId/dares/gifts
   */
  @Get("gifts")
  getGiftList() {
    return { gifts: this.dareService.getGiftList() };
  }

  /**
   * Get dares for a room
   * GET /streaming/rooms/:roomId/dares/history
   */
  @Get("history")
  async getRoomDares(@Param("roomId") roomId: string) {
    return await this.dareService.getRoomDares(roomId);
  }

  /**
   * View/browse a dare (for real-time sync)
   * POST /streaming/rooms/:roomId/dares/view
   */
  @Post("view")
  async viewDare(
    @Param("roomId") roomId: string,
    @Body() body: unknown
  ) {
    const { dareId, userId } = viewDareSchema.parse(body);
    await this.dareService.viewDare(roomId, userId, dareId);
    return { success: true };
  }

  /**
   * Assign a dare to a user
   * POST /streaming/rooms/:roomId/dares/assign
   */
  @Post("assign")
  async assignDare(
    @Param("roomId") roomId: string,
    @Body() body: unknown
  ) {
    const { assignedToUserId, dareId, userId } = assignDareSchema.parse(body);
    await this.dareService.assignDare(roomId, userId, assignedToUserId, dareId);
    return { success: true };
  }

  /**
   * Send dare with gift (100% payment transferred immediately)
   * POST /streaming/rooms/:roomId/dares/send
   */
  @Post("send")
  async sendDare(
    @Param("roomId") roomId: string,
    @Body() body: unknown
  ) {
    const { dareId, giftId, userId } = sendDareSchema.parse(body);
    const result = await this.dareService.sendDare(roomId, userId, dareId, giftId);
    return { success: true, ...result };
  }

  /**
   * Legacy: Select a dare (kept for backward compatibility - redirects to viewDare)
   * POST /streaming/rooms/:roomId/dares/select
   */
  @Post("select")
  async selectDare(
    @Param("roomId") roomId: string,
    @Body() body: unknown
  ) {
    const { dareId, userId } = viewDareSchema.parse(body);
    await this.dareService.viewDare(roomId, userId, dareId);
    return { success: true };
  }

  /**
   * Legacy: Perform a dare (kept for backward compatibility)
   * POST /streaming/rooms/:roomId/dares/:dareId/perform
   * Note: This endpoint is deprecated with simplified flow - dares are completed when sent
   */
  @Post(":dareId/perform")
  async performDare(
    @Param("roomId") _roomId: string,
    @Param("dareId") _dareId: string,
    @Body() body: unknown
  ) {
    performDareSchema.parse(body); // Validate input but don't use it
    // Legacy endpoint - just return success as dare is completed when sent
    return { success: true, message: "Dare already completed when sent" };
  }

  /**
   * Save custom dare for personal use
   * POST /streaming/rooms/:roomId/dares/custom/save
   */
  @Post("custom/save")
  async saveCustomDare(
    @Param("roomId") _roomId: string,
    @Body() body: unknown
  ) {
    const { userId, dareText, category } = z.object({
      userId: z.string(),
      dareText: z.string().min(1).max(500),
      category: z.string().optional()
    }).parse(body);
    
    const result = await this.dareService.saveCustomDare(userId, dareText, category);
    return { success: true, ...result };
  }

  /**
   * Get user's saved custom dares
   * GET /streaming/rooms/:roomId/dares/custom
   */
  @Get("custom")
  async getUserCustomDares(
    @Param("roomId") _roomId: string,
    @Query("userId") userId: string
  ) {
    if (!userId) {
      throw new Error("userId query parameter is required");
    }
    const dares = await this.dareService.getUserCustomDares(userId);
    return { dares };
  }

  /**
   * Delete a user's custom dare
   * DELETE /streaming/rooms/:roomId/dares/custom/:dareId
   */
  @Delete("custom/:dareId")
  async deleteCustomDare(
    @Param("roomId") _roomId: string,
    @Param("dareId") dareId: string,
    @Query("userId") userId: string
  ) {
    if (!userId) {
      throw new Error("userId query parameter is required");
    }
    await this.dareService.deleteCustomDare(userId, dareId);
    return { success: true };
  }

  /**
   * Get random dares for UI (with custom dares mixed in)
   * GET /streaming/rooms/:roomId/dares/random
   */
  @Get("random")
  async getRandomDares(
    @Param("roomId") _roomId: string,
    @Query("userId") userId: string,
    @Query("count") count?: string,
    @Query("interval") interval?: string
  ) {
    if (!userId) {
      throw new Error("userId query parameter is required");
    }
    const dares = await this.dareService.getRandomDaresForUI(
      userId,
      count ? parseInt(count) : 7,
      interval ? parseInt(interval) : 3
    );
    return { dares };
  }

}
