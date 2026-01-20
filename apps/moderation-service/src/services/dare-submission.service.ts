import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class DareSubmissionService {
  private readonly logger = new Logger(DareSubmissionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Submit a custom dare to moderation team
   */
  async submitDare(userId: string, dareText: string): Promise<{ id: string }> {
    const submission = await this.prisma.dareSubmission.create({
      data: {
        userId,
        dareText,
        status: "PENDING"
      }
    });
    
    this.logger.log(`User ${userId} submitted dare for moderation: ${submission.id}`);
    return { id: submission.id };
  }

  /**
   * Get all pending submissions (for moderation team)
   */
  async getPendingSubmissions(): Promise<Array<{
    id: string;
    userId: string;
    dareText: string;
    createdAt: Date;
  }>> {
    return await this.prisma.dareSubmission.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        dareText: true,
        createdAt: true
      }
    });
  }

  /**
   * Get all submissions (for moderation team)
   */
  async getAllSubmissions(status?: "PENDING" | "APPROVED" | "REJECTED"): Promise<Array<{
    id: string;
    userId: string;
    dareText: string;
    status: string;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    notes: string | null;
    createdAt: Date;
  }>> {
    const where = status ? { status } : {};
    return await this.prisma.dareSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        dareText: true,
        status: true,
        reviewedBy: true,
        reviewedAt: true,
        notes: true,
        createdAt: true
      }
    });
  }

  /**
   * Review a dare submission (approve/reject)
   */
  async reviewSubmission(
    submissionId: string,
    reviewerId: string,
    status: "APPROVED" | "REJECTED",
    notes?: string
  ): Promise<void> {
    const submission = await this.prisma.dareSubmission.findUnique({
      where: { id: submissionId }
    });
    
    if (!submission) {
      throw new NotFoundException(`Submission ${submissionId} not found`);
    }
    
    await this.prisma.dareSubmission.update({
      where: { id: submissionId },
      data: {
        status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        notes: notes || null
      }
    });
    
    this.logger.log(`Submission ${submissionId} ${status.toLowerCase()} by ${reviewerId}`);
  }
}
