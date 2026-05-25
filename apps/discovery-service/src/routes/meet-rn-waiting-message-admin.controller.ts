import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { z } from "zod";
import { MeetRnWaitingMessageService } from "../services/meet-rn-waiting-message.service.js";

const createMessageSchema = z.object({
  text: z.string().min(1).max(200),
  order: z.number().optional(),
  createdBy: z.string().optional()
});

const updateMessageSchema = z.object({
  text: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
  order: z.number().optional()
});

@Controller("discovery/admin/meet-rn-waiting-messages")
export class MeetRnWaitingMessageAdminController {
  constructor(private readonly meetRnWaitingMessageService: MeetRnWaitingMessageService) {}

  /**
   * GET /discovery/admin/meet-rn-waiting-messages
   */
  @Get()
  async getAll() {
    const messages = await this.meetRnWaitingMessageService.getAllMessages();
    return {
      ok: true,
      messages
    };
  }

  /**
   * GET /discovery/admin/meet-rn-waiting-messages/active
   */
  @Get("active")
  async getActive() {
    const messages = await this.meetRnWaitingMessageService.getActiveMessages();
    return {
      ok: true,
      messages
    };
  }

  /**
   * POST /discovery/admin/meet-rn-waiting-messages
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const data = createMessageSchema.parse(body);
    try {
      const message = await this.meetRnWaitingMessageService.createMessage(data);
      return {
        ok: true,
        message
      };
    } catch (error: any) {
      throw new HttpException(error.message || "Failed to create message", HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * PATCH /discovery/admin/meet-rn-waiting-messages/:id
   */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const data = updateMessageSchema.parse(body);
    try {
      const message = await this.meetRnWaitingMessageService.updateMessage(id, data);
      return {
        ok: true,
        message
      };
    } catch (error: any) {
      const status = error.message?.includes("not found")
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
      throw new HttpException(error.message || "Failed to update message", status);
    }
  }

  /**
   * DELETE /discovery/admin/meet-rn-waiting-messages/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param("id") id: string) {
    try {
      await this.meetRnWaitingMessageService.deleteMessage(id);
      return { ok: true };
    } catch (error: any) {
      const status = error.message?.includes("not found")
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
      throw new HttpException(error.message || "Failed to delete message", status);
    }
  }

  /**
   * DELETE /discovery/admin/meet-rn-waiting-messages/:id/hard
   */
  @Delete(":id/hard")
  @HttpCode(HttpStatus.NO_CONTENT)
  async hardDelete(@Param("id") id: string) {
    try {
      await this.meetRnWaitingMessageService.hardDeleteMessage(id);
      return { ok: true };
    } catch (error: any) {
      const status = error.message?.includes("not found")
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
      throw new HttpException(error.message || "Failed to delete message", status);
    }
  }
}
