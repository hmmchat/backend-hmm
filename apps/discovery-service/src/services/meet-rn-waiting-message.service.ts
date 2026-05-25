import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { MEET_RN_WAITING_MESSAGES } from "../config/meet-rn-waiting-messages.config.js";

@Injectable()
export class MeetRnWaitingMessageService {
  private readonly logger = new Logger(MeetRnWaitingMessageService.name);

  constructor(private readonly prisma: PrismaService) {}

  private pickRandom<T>(items: T[]): T {
    const index = Math.floor(Math.random() * items.length);
    return items[index];
  }

  /**
   * Returns a random active subtext for the Meet RN waiting screen.
   * Falls back to the static config list when the database is empty.
   */
  async getRandomMessage(): Promise<string> {
    const activeMessages = await this.getActiveMessageTexts();
    if (activeMessages.length === 0) {
      this.logger.warn("No active Meet RN waiting messages in database, using fallback list");
      return this.pickRandom([...MEET_RN_WAITING_MESSAGES]);
    }

    return this.pickRandom(activeMessages);
  }

  async getActiveMessageTexts(): Promise<string[]> {
    try {
      const rows = await (this.prisma as any).meetRnWaitingMessage.findMany({
        where: { isActive: true },
        select: { text: true },
        orderBy: [{ order: "asc" }, { createdAt: "desc" }]
      });
      return rows.map((row: { text: string }) => row.text);
    } catch (error: any) {
      this.logger.error(`Error fetching Meet RN waiting messages: ${error.message}`);
      return [];
    }
  }

  async getAllMessages() {
    return (this.prisma as any).meetRnWaitingMessage.findMany({
      orderBy: [{ isActive: "desc" }, { order: "asc" }, { createdAt: "desc" }]
    });
  }

  async getActiveMessages() {
    return (this.prisma as any).meetRnWaitingMessage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        text: true,
        order: true
      },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }]
    });
  }

  async createMessage(data: {
    text: string;
    order?: number;
    createdBy?: string;
  }) {
    if (!data.text.trim()) {
      throw new Error("Text is required");
    }

    return (this.prisma as any).meetRnWaitingMessage.create({
      data: {
        text: data.text.trim(),
        order: data.order ?? null,
        createdBy: data.createdBy ?? null,
        isActive: true
      },
      select: {
        id: true,
        text: true,
        isActive: true,
        order: true
      }
    });
  }

  async updateMessage(
    id: string,
    data: {
      text?: string;
      isActive?: boolean;
      order?: number;
    }
  ) {
    const existing = await (this.prisma as any).meetRnWaitingMessage.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Meet RN waiting message with id ${id} not found`);
    }

    const updateData: {
      text?: string;
      isActive?: boolean;
      order?: number | null;
    } = {};

    if (data.text !== undefined) {
      if (!data.text.trim()) {
        throw new Error("Text cannot be empty");
      }
      updateData.text = data.text.trim();
    }
    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }
    if (data.order !== undefined) {
      updateData.order = data.order ?? null;
    }

    return (this.prisma as any).meetRnWaitingMessage.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        text: true,
        isActive: true,
        order: true
      }
    });
  }

  async deleteMessage(id: string): Promise<void> {
    const existing = await (this.prisma as any).meetRnWaitingMessage.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Meet RN waiting message with id ${id} not found`);
    }

    await (this.prisma as any).meetRnWaitingMessage.update({
      where: { id },
      data: { isActive: false }
    });
  }

  async hardDeleteMessage(id: string): Promise<void> {
    const existing = await (this.prisma as any).meetRnWaitingMessage.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Meet RN waiting message with id ${id} not found`);
    }

    await (this.prisma as any).meetRnWaitingMessage.delete({ where: { id } });
  }
}
