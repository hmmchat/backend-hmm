import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

// Fallback list if database is empty (migration helper)
const DEFAULT_LOADING_MEMES = [
  {
    text: "You can be an asshole. But what's the reason? why?",
    imageUrl: "https://cdn.hmmchat.live/memes/disaster-girl.jpg"
  },
  {
    text: "Waiting for someone to match your energy...",
    imageUrl: "https://cdn.hmmchat.live/memes/waiting.jpg"
  },
  {
    text: "Delivering you a human now",
    imageUrl: "https://cdn.hmmchat.live/memes/delivery.jpg"
  }
];

@Injectable()
export class LoadingMemeService {
  private readonly logger = new Logger(LoadingMemeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get a random loading screen meme from database
   * Falls back to default list if database is empty
   */
  async getRandomMeme(): Promise<{ text: string; imageUrl: string }> {
    try {
      const activeMemes = await (this.prisma as any).loadingScreenMeme.findMany({
        where: { isActive: true },
        select: { text: true, imageUrl: true },
        orderBy: { order: "asc" } // Optional: respect ordering if set
      });

      if (activeMemes.length === 0) {
        // Fallback to default list if database is empty (e.g., during migration)
        this.logger.warn("No active loading screen memes in database, using fallback list");
        const randomIndex = Math.floor(Math.random() * DEFAULT_LOADING_MEMES.length);
        return DEFAULT_LOADING_MEMES[randomIndex];
      }

      const randomIndex = Math.floor(Math.random() * activeMemes.length);
      const meme = activeMemes[randomIndex];
      this.logger.debug(`Generated random loading meme: ${meme.text}`);
      return meme;
    } catch (error: any) {
      this.logger.error(`Error fetching loading meme from database: ${error.message}`);
      // Fallback to default list on error
      const randomIndex = Math.floor(Math.random() * DEFAULT_LOADING_MEMES.length);
      return DEFAULT_LOADING_MEMES[randomIndex];
    }
  }

  /**
   * Get all loading screen memes (for testing/admin purposes)
   */
  async getAllMemes(): Promise<Array<{
    id: string;
    text: string;
    imageUrl: string;
    category: string | null;
    isActive: boolean;
    order: number | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    return await (this.prisma as any).loadingScreenMeme.findMany({
      orderBy: [
        { isActive: "desc" },
        { order: "asc" },
        { createdAt: "desc" }
      ]
    });
  }

  /**
   * Get active loading screen memes only
   */
  async getActiveMemes(): Promise<Array<{
    id: string;
    text: string;
    imageUrl: string;
    category: string | null;
  }>> {
    return await (this.prisma as any).loadingScreenMeme.findMany({
      where: { isActive: true },
      select: {
        id: true,
        text: true,
        imageUrl: true,
        category: true
      },
      orderBy: [
        { order: "asc" },
        { createdAt: "desc" }
      ]
    });
  }

  /**
   * Create a new loading screen meme
   */
  async createMeme(data: {
    text: string;
    imageUrl: string;
    category?: string;
    order?: number;
    createdBy?: string;
  }): Promise<{
    id: string;
    text: string;
    imageUrl: string;
    category: string | null;
    isActive: boolean;
    order: number | null;
  }> {
    if (!data.text || data.text.trim().length === 0) {
      throw new Error("Text is required");
    }
    if (!data.imageUrl || data.imageUrl.trim().length === 0) {
      throw new Error("Image URL is required");
    }

    const meme = await (this.prisma as any).loadingScreenMeme.create({
      data: {
        text: data.text.trim(),
        imageUrl: data.imageUrl.trim(),
        category: data.category?.trim() || null,
        order: data.order || null,
        createdBy: data.createdBy || null,
        isActive: true
      },
      select: {
        id: true,
        text: true,
        imageUrl: true,
        category: true,
        isActive: true,
        order: true
      }
    });

    this.logger.log(`Created loading screen meme: ${meme.id} - "${meme.text}"`);
    return meme;
  }

  /**
   * Update a loading screen meme
   */
  async updateMeme(
    id: string,
    data: {
      text?: string;
      imageUrl?: string;
      category?: string;
      isActive?: boolean;
      order?: number;
    }
  ): Promise<{
    id: string;
    text: string;
    imageUrl: string;
    category: string | null;
    isActive: boolean;
    order: number | null;
  }> {
    const existing = await (this.prisma as any).loadingScreenMeme.findUnique({
      where: { id }
    });
    if (!existing) {
      throw new Error(`Loading screen meme with id ${id} not found`);
    }

    const updateData: any = {};
    if (data.text !== undefined) {
      if (data.text.trim().length === 0) {
        throw new Error("Text cannot be empty");
      }
      updateData.text = data.text.trim();
    }
    if (data.imageUrl !== undefined) {
      if (data.imageUrl.trim().length === 0) {
        throw new Error("Image URL cannot be empty");
      }
      updateData.imageUrl = data.imageUrl.trim();
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

    const updated = await (this.prisma as any).loadingScreenMeme.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        text: true,
        imageUrl: true,
        category: true,
        isActive: true,
        order: true
      }
    });

    this.logger.log(`Updated loading screen meme: ${id}`);
    return updated;
  }

  /**
   * Delete a loading screen meme (soft delete by setting isActive = false)
   */
  async deleteMeme(id: string): Promise<void> {
    const existing = await (this.prisma as any).loadingScreenMeme.findUnique({
      where: { id }
    });
    if (!existing) {
      throw new Error(`Loading screen meme with id ${id} not found`);
    }

    await (this.prisma as any).loadingScreenMeme.update({
      where: { id },
      data: { isActive: false }
    });

    this.logger.log(`Deleted (deactivated) loading screen meme: ${id}`);
  }

  /**
   * Hard delete a loading screen meme (permanent)
   */
  async hardDeleteMeme(id: string): Promise<void> {
    const existing = await (this.prisma as any).loadingScreenMeme.findUnique({
      where: { id }
    });
    if (!existing) {
      throw new Error(`Loading screen meme with id ${id} not found`);
    }

    await (this.prisma as any).loadingScreenMeme.delete({ where: { id } });
    this.logger.log(`Hard deleted loading screen meme: ${id}`);
  }
}
