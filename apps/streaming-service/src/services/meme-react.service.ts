import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { MemeReactConfig } from "../config/meme-react.config.js";

export type MemeReactPhase = "preparing" | "live";

export interface MemeReactRoomState {
  active: boolean;
  driverUserId: string;
  phase: MemeReactPhase;
  startedAt: number;
}

@Injectable()
export class MemeReactService {
  private readonly logger = new Logger(MemeReactService.name);
  private readonly roomState = new Map<string, MemeReactRoomState>();
  private roomBroadcaster: ((roomId: string, message: { type: string; data?: any }) => void) | null = null;

  constructor(private readonly config: MemeReactConfig) {}

  setRoomBroadcaster(
    fn: (roomId: string, message: { type: string; data?: any }) => void
  ): void {
    this.roomBroadcaster = fn;
  }

  getState(roomId: string): MemeReactRoomState | null {
    const state = this.roomState.get(roomId);
    return state ? { ...state } : null;
  }

  assertCanStart(userId: string): void {
    if (!this.config.isUserWhitelisted(userId)) {
      throw new BadRequestException("Meme React is not available for this user");
    }
  }

  start(
    roomId: string,
    userId: string,
    opts?: { hasActiveScreenShare?: boolean }
  ): MemeReactRoomState {
    this.assertCanStart(userId);
    if (opts?.hasActiveScreenShare) {
      throw new BadRequestException("End screen share before starting Meme React");
    }

    const existing = this.roomState.get(roomId);
    if (existing?.active) {
      throw new BadRequestException("Meme React is already active in this room");
    }

    const state: MemeReactRoomState = {
      active: true,
      driverUserId: userId,
      phase: "preparing",
      startedAt: Date.now()
    };
    this.roomState.set(roomId, state);

    this.roomBroadcaster?.(roomId, {
      type: "meme-react-started",
      data: this.publicState(roomId, state)
    });
    this.broadcastState(roomId, state);
    return { ...state };
  }

  end(roomId: string, userId: string): MemeReactRoomState | null {
    const state = this.roomState.get(roomId);
    if (!state?.active) return null;
    if (state.driverUserId !== userId) {
      throw new BadRequestException("Only the Meme React driver can end the session");
    }

    this.roomState.delete(roomId);

    this.roomBroadcaster?.(roomId, {
      type: "meme-react-ended",
      data: { roomId, driverUserId: userId }
    });
    return { ...state, active: false };
  }

  goLive(roomId: string, userId: string): MemeReactRoomState {
    const state = this.requireActiveDriver(roomId, userId);
    if (state.phase === "live") return { ...state };

    state.phase = "live";
    this.roomState.set(roomId, state);
    this.broadcastState(roomId, state);
    return { ...state };
  }

  async onDriverLeft(roomId: string, userId: string): Promise<void> {
    const state = this.roomState.get(roomId);
    if (!state?.active || state.driverUserId !== userId) return;
    await this.endMemeReactForRoom(roomId, "driver_left");
  }

  async onCallEnded(roomId: string): Promise<void> {
    await this.endMemeReactForRoom(roomId, "call_ended");
  }

  private endMemeReactForRoom(roomId: string, reason: string): void {
    const state = this.roomState.get(roomId);
    if (!state) return;
    const driverUserId = state.driverUserId;
    this.roomState.delete(roomId);
    this.roomBroadcaster?.(roomId, {
      type: "meme-react-ended",
      data: { roomId, driverUserId, reason }
    });
    this.logger.log(`Meme React ended for room ${roomId} (${reason})`);
  }

  private requireActiveDriver(roomId: string, userId: string): MemeReactRoomState {
    const state = this.roomState.get(roomId);
    if (!state?.active) {
      throw new BadRequestException("Meme React is not active in this room");
    }
    if (state.driverUserId !== userId) {
      throw new BadRequestException("Only the Meme React driver can perform this action");
    }
    return state;
  }

  private broadcastState(roomId: string, state: MemeReactRoomState): void {
    this.roomBroadcaster?.(roomId, {
      type: "meme-react-state",
      data: this.publicState(roomId, state)
    });
  }

  private publicState(roomId: string, state: MemeReactRoomState) {
    return {
      roomId,
      active: state.active,
      driverUserId: state.driverUserId,
      phase: state.phase
    };
  }
}
