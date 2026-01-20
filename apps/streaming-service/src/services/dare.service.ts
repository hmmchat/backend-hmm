import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { WalletClientService } from "./wallet-client.service.js";

// Predefined dare list
const DARE_LIST = [
  { id: "dare-1", text: "Eat a chilli", category: "fun" },
  { id: "dare-2", text: "Do your best impression of a celebrity", category: "fun" },
  { id: "dare-3", text: "Sing a song in a funny voice", category: "fun" },
  { id: "dare-4", text: "Tell your most embarrassing story", category: "personal" },
  { id: "dare-5", text: "Do 10 push-ups", category: "physical" },
  { id: "dare-6", text: "Dance to a random song", category: "fun" },
  { id: "dare-7", text: "Tell a joke", category: "fun" },
  { id: "dare-8", text: "Imitate someone in the call", category: "fun" },
  { id: "dare-9", text: "Share your weirdest talent", category: "personal" },
  { id: "dare-10", text: "Do your best animal impression", category: "fun" },
  { id: "dare-11", text: "Tell us about your first crush", category: "personal" }
];

// Gift list with diamond costs (from screenshot: monkey 50, pikachu 250, superman 2000, ironman 25000)
export const GIFT_LIST = [
  { id: "monkey", name: "Monkey", emoji: "🐵", diamonds: 50 },
  { id: "pikachu", name: "Pikachu", emoji: "⚡", diamonds: 250 },
  { id: "superman", name: "Superman", emoji: "🦸", diamonds: 2000 },
  { id: "ironman", name: "Iron Man", emoji: "🤖", diamonds: 25000 }
];

@Injectable()
export class DareService {
  private readonly logger = new Logger(DareService.name);

  constructor(
    private prisma: PrismaService,
    private walletClient: WalletClientService
  ) {}

  /**
   * Get list of available dares
   */
  getDareList(): Array<{ id: string; text: string; category: string }> {
    return DARE_LIST;
  }

  /**
   * Get list of available gifts with diamond costs
   */
  getGiftList(): Array<{ id: string; name: string; emoji: string; diamonds: number }> {
    return GIFT_LIST;
  }

  /**
   * View/browse a dare (for real-time synchronization)
   * When user scrolls through dares, other participants see the same dare
   */
  async viewDare(roomId: string, userId: string, dareId: string): Promise<void> {
    const dare = DARE_LIST.find(d => d.id === dareId);
    if (!dare) {
      throw new NotFoundException(`Dare ${dareId} not found`);
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check if user is a participant
    const isParticipant = await this.isParticipant(roomId, userId);
    if (!isParticipant) {
      throw new BadRequestException(`User ${userId} is not a participant in room ${roomId}`);
    }

    // Find or create a "viewing" dare record
    // Delete any existing viewing dares for this user in this room
    await this.prisma.callDare.deleteMany({
      where: {
        sessionId: session.id,
        selectedBy: userId,
        status: "viewing"
      }
    });

    // Create new viewing dare record
    await this.prisma.callDare.create({
      data: {
        sessionId: session.id,
        dareId,
        selectedBy: userId,
        status: "viewing"
      }
    });

    this.logger.log(`User ${userId} viewing dare ${dareId} in room ${roomId}`);
  }

  /**
   * Assign a dare to a specific user
   */
  async assignDare(roomId: string, assignerId: string, assignedToUserId: string, dareId: string): Promise<void> {
    const dare = DARE_LIST.find(d => d.id === dareId);
    if (!dare) {
      throw new NotFoundException(`Dare ${dareId} not found`);
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check if both users are participants
    const assignerIsParticipant = await this.isParticipant(roomId, assignerId);
    const assigneeIsParticipant = await this.isParticipant(roomId, assignedToUserId);

    if (!assignerIsParticipant) {
      throw new BadRequestException(`User ${assignerId} is not a participant in room ${roomId}`);
    }

    if (!assigneeIsParticipant) {
      throw new BadRequestException(`User ${assignedToUserId} is not a participant in room ${roomId}`);
    }

    if (assignerId === assignedToUserId) {
      throw new BadRequestException("Cannot assign dare to yourself");
    }

    // Delete any existing viewing dare for this assigner
    await this.prisma.callDare.deleteMany({
      where: {
        sessionId: session.id,
        selectedBy: assignerId,
        status: "viewing"
      }
    });

    // Create assigned dare record
    await this.prisma.callDare.create({
      data: {
        sessionId: session.id,
        dareId,
        selectedBy: assignerId,
        assignedTo: assignedToUserId,
        status: "assigned",
        assignedAt: new Date()
      }
    });

    this.logger.log(`Dare ${dareId} assigned by ${assignerId} to ${assignedToUserId} in room ${roomId}`);
  }

  /**
   * Send dare with gift (transfers 100% payment immediately)
   */
  async sendDare(
    roomId: string,
    senderId: string,
    dareId: string,
    giftId: string
  ): Promise<{ transactionId: string; newBalance: number; assignedTo: string; wasAutoAssigned: boolean }> {
    const dare = DARE_LIST.find(d => d.id === dareId);
    if (!dare) {
      throw new NotFoundException(`Dare ${dareId} not found`);
    }

    const gift = GIFT_LIST.find(g => g.id === giftId);
    if (!gift) {
      throw new NotFoundException(`Gift ${giftId} not found`);
    }

    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            status: "active"
          }
        }
      }
    });

    if (!session) {
      throw new NotFoundException(`Session for room ${roomId} not found`);
    }

    // Check if there's already an active ("sent") dare in this room
    // Only one dare can be active at a time - others must wait
    const activeDare = await this.prisma.callDare.findFirst({
      where: {
        sessionId: session.id,
        status: "sent"
      }
    });

    if (activeDare) {
      throw new BadRequestException(
        `There is already an active dare in this room. Only one dare can be active at a time. ` +
        `Current active dare: ${activeDare.dareId} (assigned to ${activeDare.assignedTo})`
      );
    }

    // Get active participants
    const activeParticipants = session.participants.map(p => p.userId);
    const participantCount = activeParticipants.length;

    // Find the assigned dare, or check if we need to auto-assign (2 users only)
    let dareRecord = await this.prisma.callDare.findFirst({
      where: {
        sessionId: session.id,
        dareId,
        selectedBy: senderId,
        status: "assigned"
      }
    });

    // If no assignment exists and there are exactly 2 participants, auto-assign to the other user
    let wasAutoAssigned = false;
    if (!dareRecord && participantCount === 2) {
      const otherUserId = activeParticipants.find(id => id !== senderId);
      if (!otherUserId) {
        throw new BadRequestException("Cannot find other participant in 2-user call");
      }

      // Auto-assign the dare to the other user
      dareRecord = await this.prisma.callDare.create({
        data: {
          sessionId: session.id,
          dareId,
          selectedBy: senderId,
          assignedTo: otherUserId,
          status: "assigned",
          assignedAt: new Date()
        }
      });

      wasAutoAssigned = true;
      this.logger.log(
        `Auto-assigned dare ${dareId} from ${senderId} to ${otherUserId} (2-user call)`
      );
    }

    if (!dareRecord || !dareRecord.assignedTo) {
      if (participantCount === 1) {
        throw new BadRequestException(
          "Cannot send a dare in a single-user call. Dares require at least one other participant."
        );
      }
      if (participantCount > 2) {
        throw new NotFoundException(
          `Dare ${dareId} must be assigned first when there are ${participantCount} participants`
        );
      }
      throw new NotFoundException(`Dare ${dareId} not found or not assigned`);
    }

    // Convert diamonds to coins
    const totalCoins = this.walletClient.diamondsToCoins(gift.diamonds);

    // Transfer 100% to assigned user immediately with gift information
    const paymentResult = await this.walletClient.transferCoins(
      senderId,
      dareRecord.assignedTo,
      totalCoins,
      `Dare ${dareId} with gift ${giftId}`,
      giftId // Pass giftId to wallet service
    );

    // Update dare record
    await this.prisma.callDare.update({
      where: { id: dareRecord.id },
      data: {
        giftId: gift.id,
        giftDiamonds: gift.diamonds,
        status: "sent",
        firstPaymentSent: true,
        firstTransactionId: paymentResult.transactionId,
        sentAt: new Date()
      }
    });

    this.logger.log(
      `Dare ${dareId} sent by ${senderId} to ${dareRecord.assignedTo} with gift ${giftId}. ` +
      `Paid ${totalCoins} coins (${gift.diamonds} diamonds) - 100%` +
      (wasAutoAssigned ? " (auto-assigned in 2-user call)" : "")
    );

    return {
      transactionId: paymentResult.transactionId,
      newBalance: paymentResult.newBalance,
      assignedTo: dareRecord.assignedTo,
      wasAutoAssigned
    };
  }


  /**
   * Helper: Check if user is a participant
   */
  private async isParticipant(roomId: string, userId: string): Promise<boolean> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId },
      include: {
        participants: {
          where: {
            userId,
            status: "active"
          }
        }
      }
    });

    if (!session) {
      return false;
    }

    return session.participants.length > 0;
  }

  /**
   * Legacy: Mark a dare as performed (kept for backward compatibility)
   * Note: With simplified flow, dares are completed when sent
   */
  async performDare(roomId: string, dareId: string, _performedBy: string): Promise<void> {
    // Legacy method - dares are now complete when sent, no action needed
    this.logger.log(`Legacy performDare called for dare ${dareId} in room ${roomId} (no-op)`);
  }

  /**
   * Get dares for a room
   */
  async getRoomDares(roomId: string): Promise<Array<{
    id: string;
    dareId: string;
    dareText: string;
    selectedBy: string;
    assignedTo: string | null;
    performedBy: string | null;
    status: string;
    giftId: string | null;
    giftDiamonds: number | null;
    firstPaymentSent: boolean;
    secondPaymentSent: boolean;
    createdAt: Date;
    assignedAt: Date | null;
    sentAt: Date | null;
    performedAt: Date | null;
    confirmedAt: Date | null;
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
        assignedTo: dare.assignedTo || null,
        performedBy: dare.performedBy || null,
        status: dare.status,
        giftId: dare.giftId || null,
        giftDiamonds: dare.giftDiamonds || null,
        firstPaymentSent: dare.firstPaymentSent || false,
        secondPaymentSent: dare.secondPaymentSent || false,
        createdAt: dare.createdAt,
        assignedAt: dare.assignedAt || null,
        sentAt: dare.sentAt || null,
        performedAt: dare.performedAt || null,
        confirmedAt: dare.confirmedAt || null
      };
    });
  }

  /**
   * Get current viewing dare for a room (for real-time sync)
   */
  async getCurrentViewingDare(roomId: string, userId: string): Promise<{ dareId: string; dareText: string } | null> {
    const session = await this.prisma.callSession.findUnique({
      where: { roomId }
    });

    if (!session) {
      return null;
    }

    const viewingDare = await this.prisma.callDare.findFirst({
      where: {
        sessionId: session.id,
        selectedBy: userId,
        status: "viewing"
      },
      orderBy: { createdAt: "desc" }
    });

    if (!viewingDare) {
      return null;
    }

    const dareInfo = DARE_LIST.find(d => d.id === viewingDare.dareId);
    return {
      dareId: viewingDare.dareId,
      dareText: dareInfo?.text || "Unknown dare"
    };
  }

  /**
   * Create and save a custom dare for personal use
   */
  async saveCustomDare(userId: string, dareText: string, category?: string): Promise<{ id: string }> {
    const customDare = await this.prisma.userCustomDare.create({
      data: {
        userId,
        dareText,
        category: category || null
      }
    });
    
    this.logger.log(`User ${userId} saved custom dare: ${customDare.id}`);
    return { id: customDare.id };
  }

  /**
   * Get user's saved custom dares
   */
  async getUserCustomDares(userId: string): Promise<Array<{
    id: string;
    dareText: string;
    category: string | null;
    createdAt: Date;
  }>> {
    return await this.prisma.userCustomDare.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        dareText: true,
        category: true,
        createdAt: true
      }
    });
  }

  /**
   * Delete a user's custom dare
   */
  async deleteCustomDare(userId: string, dareId: string): Promise<void> {
    const deleted = await this.prisma.userCustomDare.deleteMany({
      where: {
        id: dareId,
        userId // Ensure user can only delete their own dares
      }
    });
    
    if (deleted.count === 0) {
      throw new NotFoundException(`Custom dare ${dareId} not found or access denied`);
    }
  }

  /**
   * Get random dares for UI (6-7 dares, with custom dare every 3-4)
   */
  async getRandomDaresForUI(
    userId: string, 
    count: number = 7,
    customDareInterval: number = 3
  ): Promise<Array<{
    id: string;
    text: string;
    category: string;
    isCustom: boolean;
    customDareId?: string;
  }>> {
    // Get random dares from predefined list
    const shuffled = [...DARE_LIST].sort(() => Math.random() - 0.5);
    const selectedDares = shuffled.slice(0, count);
    
    // Get user's custom dares
    const userCustomDares = await this.getUserCustomDares(userId);
    
    // Insert custom dare every customDareInterval dares
    const result: Array<{
      id: string;
      text: string;
      category: string;
      isCustom: boolean;
      customDareId?: string;
    }> = [];
    
    let customDareIndex = 0;
    
    for (let i = 0; i < selectedDares.length; i++) {
      result.push({
        id: selectedDares[i].id,
        text: selectedDares[i].text,
        category: selectedDares[i].category,
        isCustom: false
      });
      
      // Insert custom dare every customDareInterval
      if ((i + 1) % customDareInterval === 0 && customDareIndex < userCustomDares.length) {
        const customDare = userCustomDares[customDareIndex];
        result.push({
          id: `custom-${customDare.id}`,
          text: customDare.dareText,
          category: customDare.category || "custom",
          isCustom: true,
          customDareId: customDare.id
        });
        customDareIndex++;
      }
    }
    
    return result;
  }
}
