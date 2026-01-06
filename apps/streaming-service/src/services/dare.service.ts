import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

// Predefined dare list
const DARE_LIST = [
  { id: "dare-1", text: "Do your best impression of a celebrity", category: "fun" },
  { id: "dare-2", text: "Sing a song in a funny voice", category: "fun" },
  { id: "dare-3", text: "Tell your most embarrassing story", category: "personal" },
  { id: "dare-4", text: "Do 10 push-ups", category: "physical" },
  { id: "dare-5", text: "Dance to a random song", category: "fun" },
  { id: "dare-6", text: "Tell a joke", category: "fun" },
  { id: "dare-7", text: "Imitate someone in the call", category: "fun" },
  { id: "dare-8", text: "Share your weirdest talent", category: "personal" },
  { id: "dare-9", text: "Do your best animal impression", category: "fun" },
  { id: "dare-10", text: "Tell us about your first crush", category: "personal" }
];

@Injectable()
export class DareService {
  private readonly logger = new Logger(DareService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get list of available dares
   */
  getDareList(): Array<{ id: string; text: string; category: string }> {
    return DARE_LIST;
  }

  /**
   * Select a dare for a room
   */
  async selectDare(roomId: string, userId: string, dareId: string): Promise<void> {
    const dare = DARE_LIST.find(d => d.id === dareId);
    if (!dare) {
      throw new NotFoundException(`Dare ${dareId} not found`);
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: { 
        participants: {
          where: { status: "active" }
        }
      }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check if user is a participant in the room
    // IMPORTANT: session.participants might be empty if the query doesn't include them correctly
    // So we need to verify the participants array is populated
    if (!session.participants || session.participants.length === 0) {
      // If no participants found, query directly from database to verify
      const directParticipants = await this.prisma.callParticipant.findMany({
        where: {
          sessionId: session.id,
          status: "active"
        },
        select: { userId: true }
      });
      
      const participantUserIds = directParticipants.map(p => p.userId);
      this.logger.warn(`[Dare Selection] Room ${roomId}: Participants not included in session query. Direct query found: [${participantUserIds.join(', ')}]`);
      
      if (!participantUserIds.includes(userId)) {
        throw new BadRequestException(`User ${userId} is not a participant in room ${roomId}`);
      }
    } else {
      // Participants were included in the query
      const participantUserIds = session.participants.map(p => p.userId);
      this.logger.log(`[Dare Selection] Room ${roomId}: Checking if user ${userId} is participant. Active participants: [${participantUserIds.join(', ')}]`);
      
      if (!participantUserIds.includes(userId)) {
        this.logger.warn(`[Dare Selection] User ${userId} is NOT a participant in room ${roomId}. Active participants: [${participantUserIds.join(', ')}]`);
        throw new BadRequestException(`User ${userId} is not a participant in room ${roomId}`);
      }
      
      this.logger.log(`[Dare Selection] User ${userId} is a participant. Proceeding with dare selection.`);
    }

    // Create dare selection
    await this.prisma.callDare.create({
      data: {
        sessionId: session.id,
        dareId,
        selectedBy: userId,
        status: "selected"
      }
    });

    this.logger.log(`Dare ${dareId} selected by ${userId} in room ${roomId}`);
  }

  /**
   * Mark a dare as performed
   */
  async performDare(roomId: string, dareId: string, performedBy: string): Promise<void> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    const dare = await this.prisma.callDare.findFirst({
      where: {
        sessionId: session.id,
        dareId,
        status: "selected"
      }
    });

    if (!dare) {
      throw new NotFoundException(`Dare ${dareId} not found or already performed`);
    }

    await this.prisma.callDare.update({
      where: { id: dare.id },
      data: {
        performedBy,
        status: "performed",
        performedAt: new Date()
      }
    });

    this.logger.log(`Dare ${dareId} performed by ${performedBy} in room ${roomId}`);
  }

  /**
   * Get dares for a room
   */
  async getRoomDares(roomId: string): Promise<Array<{
    id: string;
    dareId: string;
    dareText: string;
    selectedBy: string;
    performedBy: string | null;
    status: string;
    createdAt: Date;
    performedAt: Date | null;
  }>> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      return [];
    }

    const dares = await this.prisma.callDare.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" }
    });

    return dares.map(dare => {
      const dareInfo = DARE_LIST.find(d => d.id === dare.dareId);
      return {
        id: dare.id,
        dareId: dare.dareId,
        dareText: dareInfo?.text || "Unknown dare",
        selectedBy: dare.selectedBy,
        performedBy: dare.performedBy,
        status: dare.status,
        createdAt: dare.createdAt,
        performedAt: dare.performedAt
      };
    });
  }
}
