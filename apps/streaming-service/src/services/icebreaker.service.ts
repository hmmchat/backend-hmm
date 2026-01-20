import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

// Fallback list if database is empty (migration helper)
const DEFAULT_ICEBREAKER_LIST = [
  "What's your favorite movie of the year?",
  "What's the best book you've read recently?",
  "What's your go-to comfort food?",
  "What's your dream vacation destination?",
  "What's a skill you'd like to learn?",
  "What's your favorite way to spend a weekend?",
  "What's the most interesting place you've visited?",
  "What's a hobby you're passionate about?",
  "What's your favorite type of music?",
  "What's something on your bucket list?",
  "What's the best piece of advice you've received?",
  "What's your favorite season and why?",
  "What's a TV show you're currently watching?",
  "What's your favorite childhood memory?",
  "What's something that always makes you smile?",
  "What's your favorite way to exercise?",
  "What's a goal you're working towards?",
  "What's your favorite type of cuisine?",
  "What's something you're grateful for today?",
  "What's your favorite way to relax?",
  "What's the most adventurous thing you've done?",
  "What's your favorite holiday and why?",
  "What's a talent you have that surprises people?",
  "What's your favorite type of weather?",
  "What's something you've always wanted to try?",
  "What's your favorite way to start your day?",
  "What's a movie you could watch over and over?",
  "What's your favorite social media platform?",
  "What's something that motivates you?",
  "What's your favorite way to end your day?"
];

@Injectable()
export class IcebreakerService {
  private readonly logger = new Logger(IcebreakerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get a random icebreaker question from database
   * Falls back to default list if database is empty
   */
  async getRandomIcebreaker(): Promise<string> {
    try {
      const activeIcebreakers = await this.prisma.icebreaker.findMany({
        where: { isActive: true },
        select: { question: true },
        orderBy: { order: 'asc' } // Optional: respect ordering if set
      });

      if (activeIcebreakers.length === 0) {
        // Fallback to default list if database is empty (e.g., during migration)
        this.logger.warn("No active icebreakers in database, using fallback list");
        const randomIndex = Math.floor(Math.random() * DEFAULT_ICEBREAKER_LIST.length);
        return DEFAULT_ICEBREAKER_LIST[randomIndex];
      }

      const randomIndex = Math.floor(Math.random() * activeIcebreakers.length);
      const icebreaker = activeIcebreakers[randomIndex].question;
      this.logger.debug(`Generated random icebreaker: ${icebreaker}`);
      return icebreaker;
    } catch (error: any) {
      this.logger.error(`Error fetching icebreaker from database: ${error.message}`);
      // Fallback to default list on error
      const randomIndex = Math.floor(Math.random() * DEFAULT_ICEBREAKER_LIST.length);
      return DEFAULT_ICEBREAKER_LIST[randomIndex];
    }
  }

  /**
   * Get all icebreakers (for testing/admin purposes)
   */
  async getAllIcebreakers(): Promise<Array<{ id: string; question: string; category: string | null; isActive: boolean; order: number | null; createdAt: Date; updatedAt: Date }>> {
    return await this.prisma.icebreaker.findMany({
      orderBy: [
        { isActive: 'desc' },
        { order: 'asc' },
        { createdAt: 'desc' }
      ]
    });
  }

  /**
   * Get active icebreakers only
   */
  async getActiveIcebreakers(): Promise<Array<{ id: string; question: string; category: string | null }>> {
    return await this.prisma.icebreaker.findMany({
      where: { isActive: true },
      select: {
        id: true,
        question: true,
        category: true
      },
      orderBy: [
        { order: 'asc' },
        { createdAt: 'desc' }
      ]
    });
  }

  /**
   * Create a new icebreaker
   */
  async createIcebreaker(data: { question: string; category?: string; order?: number; createdBy?: string }): Promise<{ id: string; question: string; category: string | null; isActive: boolean; order: number | null }> {
    if (!data.question || data.question.trim().length === 0) {
      throw new BadRequestException("Question is required");
    }

    const icebreaker = await this.prisma.icebreaker.create({
      data: {
        question: data.question.trim(),
        category: data.category?.trim() || null,
        order: data.order || null,
        createdBy: data.createdBy || null,
        isActive: true
      },
      select: {
        id: true,
        question: true,
        category: true,
        isActive: true,
        order: true
      }
    });

    this.logger.log(`Created icebreaker: ${icebreaker.id} - "${icebreaker.question}"`);
    return icebreaker;
  }

  /**
   * Update an icebreaker
   */
  async updateIcebreaker(id: string, data: { question?: string; category?: string; isActive?: boolean; order?: number }): Promise<{ id: string; question: string; category: string | null; isActive: boolean; order: number | null }> {
    const existing = await this.prisma.icebreaker.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Icebreaker with id ${id} not found`);
    }

    const updateData: any = {};
    if (data.question !== undefined) {
      if (data.question.trim().length === 0) {
        throw new BadRequestException("Question cannot be empty");
      }
      updateData.question = data.question.trim();
    }
    if (data.category !== undefined) {
      updateData.category = data.category?.trim() || null;
    }
    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }
    if (data.order !== undefined) {
      updateData.order = data.order || null;
    }

    const updated = await this.prisma.icebreaker.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        question: true,
        category: true,
        isActive: true,
        order: true
      }
    });

    this.logger.log(`Updated icebreaker: ${id}`);
    return updated;
  }

  /**
   * Delete an icebreaker (soft delete by setting isActive = false)
   */
  async deleteIcebreaker(id: string): Promise<void> {
    const existing = await this.prisma.icebreaker.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Icebreaker with id ${id} not found`);
    }

    await this.prisma.icebreaker.update({
      where: { id },
      data: { isActive: false }
    });

    this.logger.log(`Deleted (deactivated) icebreaker: ${id}`);
  }

  /**
   * Hard delete an icebreaker (permanent)
   */
  async hardDeleteIcebreaker(id: string): Promise<void> {
    const existing = await this.prisma.icebreaker.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Icebreaker with id ${id} not found`);
    }

    await this.prisma.icebreaker.delete({ where: { id } });
    this.logger.log(`Hard deleted icebreaker: ${id}`);
  }
}
