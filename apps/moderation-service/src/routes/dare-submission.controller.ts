import { Controller, Post, Get, Put, Body, Param, Query } from "@nestjs/common";
import { DareSubmissionService } from "../services/dare-submission.service.js";
import { z } from "zod";

@Controller("moderation/dare-submissions")
export class DareSubmissionController {
  constructor(private readonly dareSubmissionService: DareSubmissionService) {}

  @Post()
  async submitDare(@Body() body: unknown) {
    const { userId, dareText } = z.object({
      userId: z.string(),
      dareText: z.string().min(1).max(500)
    }).parse(body);
    
    const result = await this.dareSubmissionService.submitDare(userId, dareText);
    return { success: true, ...result };
  }

  @Get("pending")
  async getPendingSubmissions() {
    const submissions = await this.dareSubmissionService.getPendingSubmissions();
    return { submissions };
  }

  @Get()
  async getAllSubmissions(@Query("status") status?: string) {
    const validStatus = status && ["PENDING", "APPROVED", "REJECTED"].includes(status)
      ? (status as "PENDING" | "APPROVED" | "REJECTED")
      : undefined;
    const submissions = await this.dareSubmissionService.getAllSubmissions(validStatus);
    return { submissions };
  }

  @Put(":id/review")
  async reviewSubmission(
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const { reviewerId, status, notes } = z.object({
      reviewerId: z.string(),
      status: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().optional()
    }).parse(body);
    
    await this.dareSubmissionService.reviewSubmission(id, reviewerId, status, notes);
    return { success: true };
  }
}
