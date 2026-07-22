import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { MemeReactConfig } from "../config/meme-react.config.js";
import { MemeReactBrowserService } from "./meme-react-browser.service.js";

export type MemeReactPhase = "picker" | "setup" | "live";

export interface MemeReactRoomState {
  active: boolean;
  driverUserId: string;
  phase: MemeReactPhase;
  browserAudioEnabled: boolean;
  wasLiveBeforeExit: boolean;
  startedAt: number;
  callSessionId: string;
  currentUrl?: string;
  error?: string;
}

@Injectable()
export class MemeReactService {
  private readonly logger = new Logger(MemeReactService.name);
  private readonly roomState = new Map<string, MemeReactRoomState>();
  private roomBroadcaster: ((roomId: string, message: { type: string; data?: any }) => void) | null = null;
  private frameBroadcaster: ((
    roomId: string,
    driverUserId: string,
    frame: string,
    phase: MemeReactPhase
  ) => void) | null = null;

  constructor(
    private readonly config: MemeReactConfig,
    private readonly browser: MemeReactBrowserService
  ) {}

  setRoomBroadcaster(
    fn: (roomId: string, message: { type: string; data?: any }) => void
  ): void {
    this.roomBroadcaster = fn;
  }

  setFrameBroadcaster(
    fn: (roomId: string, driverUserId: string, frame: string, phase: MemeReactPhase) => void
  ): void {
    this.frameBroadcaster = fn;
    this.browser.setFrameHandler((callSessionId, frame) => {
      for (const [roomId, state] of this.roomState.entries()) {
        if (state.callSessionId !== callSessionId || !state.active) continue;
        if (state.phase === "live") continue;
        this.frameBroadcaster?.(roomId, state.driverUserId, frame, state.phase);
      }
    });
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

  async start(
    roomId: string,
    userId: string,
    callSessionId: string,
    opts?: { hasActiveScreenShare?: boolean }
  ): Promise<MemeReactRoomState> {
    this.assertCanStart(userId);
    if (opts?.hasActiveScreenShare) {
      throw new BadRequestException("Cannot start Meme React while screen share is active");
    }

    const existing = this.roomState.get(roomId);
    if (existing?.active) {
      throw new BadRequestException("Meme React is already active in this room");
    }

    const wasLiveBeforeExit = existing?.wasLiveBeforeExit ?? false;
    const phase: MemeReactPhase = wasLiveBeforeExit ? "setup" : "picker";
    const state: MemeReactRoomState = {
      active: true,
      driverUserId: userId,
      phase,
      browserAudioEnabled: true,
      wasLiveBeforeExit,
      startedAt: Date.now(),
      callSessionId
    };
    this.roomState.set(roomId, state);

    await this.browser.ensureSession(callSessionId);

    if (wasLiveBeforeExit) {
      const lastUrl = this.browser.getLastUrl(callSessionId);
      if (lastUrl) {
        state.phase = "setup";
        state.currentUrl = lastUrl;
        await this.browser.navigate(callSessionId, lastUrl);
        this.roomBroadcaster?.(roomId, {
          type: "meme-react-started",
          data: this.publicState(roomId, state)
        });
        return this.goLive(roomId, userId);
      }
    }

    this.roomBroadcaster?.(roomId, {
      type: "meme-react-started",
      data: this.publicState(roomId, state)
    });
    this.broadcastState(roomId, state);
    return { ...state };
  }

  async end(roomId: string, userId: string): Promise<MemeReactRoomState | null> {
    const state = this.roomState.get(roomId);
    if (!state?.active) return null;
    if (state.driverUserId !== userId) {
      throw new BadRequestException("Only the Meme React driver can end the session");
    }

    const wasLive = state.phase === "live";
    state.active = false;
    state.wasLiveBeforeExit = wasLive;
    this.roomState.set(roomId, {
      ...state,
      active: false,
      phase: "picker",
      wasLiveBeforeExit: wasLive
    });

    await this.browser.stopScreencast(state.callSessionId);

    this.roomBroadcaster?.(roomId, {
      type: "meme-react-ended",
      data: { roomId, wasLiveBeforeExit: wasLive }
    });
    return { ...state, active: false, wasLiveBeforeExit: wasLive };
  }

  async goLive(roomId: string, userId: string): Promise<MemeReactRoomState> {
    const state = this.requireActiveDriver(roomId, userId);
    if (state.phase === "live") return { ...state };

    state.phase = "live";
    state.browserAudioEnabled = true;
    state.error = undefined;
    this.roomState.set(roomId, state);
    await this.browser.stopScreencast(state.callSessionId);

    this.broadcastState(roomId, state);
    return { ...state };
  }

  async navigate(roomId: string, userId: string, url: string): Promise<MemeReactRoomState> {
    const state = this.requireActiveDriver(roomId, userId);
    if (!this.config.isUrlAllowed(url)) {
      state.phase = "picker";
      state.currentUrl = undefined;
      state.error = "That site is not allowed";
      this.roomState.set(roomId, state);
      this.broadcastState(roomId, state);
      throw new BadRequestException("URL is not on the allowlist");
    }

    state.phase = "setup";
    state.currentUrl = url;
    state.error = undefined;
    this.roomState.set(roomId, state);

    await this.browser.navigate(state.callSessionId, url);
    await this.browser.startScreencast(state.callSessionId);

    this.broadcastState(roomId, state);
    return { ...state };
  }

  async handleInput(
    roomId: string,
    userId: string,
    input: {
      type: "click" | "wheel" | "type" | "key" | "paste";
      x?: number;
      y?: number;
      deltaY?: number;
      text?: string;
      key?: string;
    }
  ): Promise<void> {
    const state = this.requireActiveDriver(roomId, userId);
    if (state.phase === "picker") return;
    await this.browser.handleInput(state.callSessionId, input);
  }

  toggleBrowserAudio(roomId: string, userId: string, enabled: boolean): MemeReactRoomState {
    const state = this.requireActiveDriver(roomId, userId);
    state.browserAudioEnabled = enabled;
    this.roomState.set(roomId, state);
    this.broadcastState(roomId, state);
    return { ...state };
  }

  reopenPicker(roomId: string, userId: string): MemeReactRoomState {
    const state = this.requireActiveDriver(roomId, userId);
    state.phase = "picker";
    state.error = undefined;
    this.roomState.set(roomId, state);
    void this.browser.stopScreencast(state.callSessionId);
    this.broadcastState(roomId, state);
    return { ...state };
  }

  async onDriverLeft(roomId: string, userId: string): Promise<void> {
    const state = this.roomState.get(roomId);
    if (!state?.active || state.driverUserId !== userId) return;
    await this.endMemeReactForRoom(roomId, "driver_left");
  }

  async onCallEnded(roomId: string, callSessionId?: string): Promise<void> {
    await this.endMemeReactForRoom(roomId, "call_ended");
    if (callSessionId) {
      await this.browser.destroySession(callSessionId, { purgeProfile: true });
    }
  }

  private async endMemeReactForRoom(roomId: string, reason: string): Promise<void> {
    const state = this.roomState.get(roomId);
    if (!state) return;
    await this.browser.stopScreencast(state.callSessionId);
    this.roomState.delete(roomId);
    this.roomBroadcaster?.(roomId, {
      type: "meme-react-ended",
      data: { roomId, reason, wasLiveBeforeExit: false }
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
      phase: state.phase,
      browserAudioEnabled: state.browserAudioEnabled,
      currentUrl: state.currentUrl,
      error: state.error,
      wasLiveBeforeExit: state.wasLiveBeforeExit
    };
  }
}
