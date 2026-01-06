import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { DareService } from "../services/dare.service.js";
import { z } from "zod";

const selectDareSchema = z.object({
  dareId: z.string(),
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
   * Get dares for a room
   * GET /streaming/rooms/:roomId/dares/history
   */
  @Get("history")
  async getRoomDares(@Param("roomId") roomId: string) {
    return await this.dareService.getRoomDares(roomId);
  }

  /**
   * Select a dare
   * POST /streaming/rooms/:roomId/dares/select
   */
  @Post("select")
  async selectDare(
    @Param("roomId") roomId: string,
    @Body() body: unknown
  ) {
    const { dareId, userId } = selectDareSchema.parse(body);
    await this.dareService.selectDare(roomId, userId, dareId);
    return { success: true };
  }

  /**
   * Perform a dare
   * POST /streaming/rooms/:roomId/dares/:dareId/perform
   */
  @Post(":dareId/perform")
  async performDare(
    @Param("roomId") roomId: string,
    @Param("dareId") dareId: string,
    @Body() body: unknown
  ) {
    const { performedBy } = performDareSchema.parse(body);
    await this.dareService.performDare(roomId, dareId, performedBy);
    return { success: true };
  }
}

