import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import * as mediasoup from "mediasoup";
import os from "node:os";

@Injectable()
export class MediasoupService implements OnModuleInit {
  private readonly logger = new Logger(MediasoupService.name);
  private workers: mediasoup.types.Worker[] = [];
  private routersPerWorker = new Map<number, number>();
  private workerRestartAttempts: Map<number, number> = new Map(); // Track restart attempts per worker index
  private readonly numWorkers: number;
  private readonly listenIp: string;
  private readonly announcedIp: string;
  private readonly maxRestartAttempts: number;
  private readonly restartBackoffBaseMs: number;
  private readonly restartBackoffMaxMs: number;
  private readonly rtcMinPort: number;
  private readonly rtcMaxPort: number;
  private readonly maxIncomingBitrate: number | null;
  private readonly realtimeDebugLogs: boolean;

  constructor() {
    // Use 1 worker for local dev, but default production to CPU-aware worker count.
    const defaultWorkers = process.env.NODE_ENV === "production"
      ? Math.max(1, Math.min(os.cpus().length - 1, 16))
      : 1;
    this.numWorkers = this.parsePositiveInt(process.env.MEDIASOUP_WORKERS, defaultWorkers);
    this.listenIp = process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0";
    this.announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";
    this.maxRestartAttempts = this.parsePositiveInt(process.env.MEDIASOUP_MAX_RESTART_ATTEMPTS, 5);
    this.restartBackoffBaseMs = this.parsePositiveInt(process.env.MEDIASOUP_RESTART_BACKOFF_BASE_MS, 2000);
    this.restartBackoffMaxMs = this.parsePositiveInt(process.env.MEDIASOUP_RESTART_BACKOFF_MAX_MS, 32000);
    this.rtcMinPort = this.parsePositiveInt(process.env.MEDIASOUP_RTC_MIN_PORT, 40000);
    this.rtcMaxPort = this.parsePositiveInt(process.env.MEDIASOUP_RTC_MAX_PORT, 49999);
    const incoming = process.env.MEDIASOUP_MAX_INCOMING_BITRATE;
    this.maxIncomingBitrate = incoming && incoming !== ""
      ? this.parsePositiveInt(incoming, 0)
      : null;
    this.realtimeDebugLogs = process.env.STREAMING_REALTIME_DEBUG === "true";
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = raw !== undefined && raw !== "" ? Number.parseInt(raw, 10) : fallback;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  /** Higher default for multi-party SFU (2.5 Mbps); override with MEDIASOUP_INITIAL_OUT_BITRATE */
  private getInitialAvailableOutgoingBitrate(): number {
    const raw = process.env.MEDIASOUP_INITIAL_OUT_BITRATE;
    if (raw !== undefined && raw !== "") {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 300000) return n;
    }
    return 2_500_000;
  }

  async onModuleInit() {
    this.logger.log(`Creating ${this.numWorkers} Mediasoup workers...`);
    const maxRetries = 3;
    const retryDelayMs = 2000;

    for (let i = 0; i < this.numWorkers; i++) {
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const worker = await this.createWorkerAtIndex(i);

          this.workers.push(worker);
          this.routersPerWorker.set(i, 0);
          this.logger.log(`Mediasoup worker ${i} created (PID: ${worker.pid})`);
          lastError = null;
          break;
        } catch (error: any) {
          lastError = error;
          this.logger.warn(`Failed to create Mediasoup worker ${i} (attempt ${attempt}/${maxRetries}): ${error.message}`);
          if (attempt < maxRetries) {
            this.logger.log(`Retrying in ${retryDelayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          }
        }
      }
      if (lastError) {
        this.logger.error(`Failed to create Mediasoup worker ${i} after ${maxRetries} attempts:`, lastError);
        throw lastError;
      }
    }

    this.logger.log(`✅ All ${this.numWorkers} Mediasoup workers created successfully`);
  }

  private getWorkerPortRange(workerIndex: number): { rtcMinPort: number; rtcMaxPort: number } {
    const totalPorts = this.rtcMaxPort - this.rtcMinPort + 1;
    const portsPerWorker = Math.max(1, Math.floor(totalPorts / Math.max(1, this.numWorkers)));
    const rtcMinPort = this.rtcMinPort + workerIndex * portsPerWorker;
    const isLast = workerIndex === this.numWorkers - 1;
    const rtcMaxPort = isLast ? this.rtcMaxPort : Math.min(this.rtcMaxPort, rtcMinPort + portsPerWorker - 1);
    return { rtcMinPort, rtcMaxPort };
  }

  private async createWorkerAtIndex(workerIndex: number): Promise<mediasoup.types.Worker> {
    const { rtcMinPort, rtcMaxPort } = this.getWorkerPortRange(workerIndex);
    const worker = await mediasoup.createWorker({
      logLevel: "warn",
      logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
      rtcMinPort,
      rtcMaxPort
    });

    worker.on("died", () => {
      this.logger.error(`Mediasoup worker ${workerIndex} died, attempting to restart...`);
      this.restartWorker(workerIndex).catch(err => {
        this.logger.error(`Failed to restart worker ${workerIndex}: ${err.message}`);
      });
    });

    return worker;
  }

  private getLeastLoadedWorker(): { worker: mediasoup.types.Worker; workerIndex: number } {
    let selected: { worker: mediasoup.types.Worker; workerIndex: number; routerCount: number } | null = null;
    for (const [workerIndex, worker] of this.workers.entries()) {
      if (!worker || worker.closed) continue;
      const routerCount = this.routersPerWorker.get(workerIndex) ?? 0;
      if (!selected || routerCount < selected.routerCount) {
        selected = { worker, workerIndex, routerCount };
      }
    }

    if (!selected) {
      throw new Error("No live Mediasoup workers available");
    }
    return selected;
  }

  /**
   * Create a new router for a room
   */
  async createRouter(): Promise<mediasoup.types.Router> {
    return (await this.createRouterForRoom()).router;
  }

  async createRouterForRoom(): Promise<{ router: mediasoup.types.Router; workerIndex: number }> {
    const { worker, workerIndex } = this.getLeastLoadedWorker();
    
    const router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          rtcpFeedback: [
            { type: "nack" },
            { type: "nack", parameter: "pli" },
            { type: "ccm", parameter: "fir" },
            { type: "goog-remb" }
          ]
        },
        {
          kind: "video",
          mimeType: "video/VP9",
          clockRate: 90000,
          rtcpFeedback: [
            { type: "nack" },
            { type: "nack", parameter: "pli" },
            { type: "ccm", parameter: "fir" },
            { type: "goog-remb" }
          ]
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          rtcpFeedback: [
            { type: "nack" },
            { type: "nack", parameter: "pli" },
            { type: "ccm", parameter: "fir" },
            { type: "goog-remb" }
          ],
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "42e01f",
            "level-asymmetry-allowed": 1
          }
        }
      ]
    });

    this.routersPerWorker.set(workerIndex, (this.routersPerWorker.get(workerIndex) ?? 0) + 1);
    router.observer.once("close", () => {
      this.routersPerWorker.set(workerIndex, Math.max(0, (this.routersPerWorker.get(workerIndex) ?? 1) - 1));
    });

    this.realtimeDebug(`Router created (ID: ${router.id}, workerIndex: ${workerIndex})`);
    return { router, workerIndex };
  }

  private realtimeDebug(message: string): void {
    if (this.realtimeDebugLogs) {
      this.logger.debug(message);
    }
  }

  /**
   * Get RTP capabilities for a router
   */
  getRtpCapabilities(router: mediasoup.types.Router): mediasoup.types.RtpCapabilities {
    return router.rtpCapabilities;
  }

  /**
   * Create a WebRTC transport for a participant
   */
  async createWebRtcTransport(
    router: mediasoup.types.Router,
    options: {
      producing?: boolean;
      consuming?: boolean;
    } = {}
  ): Promise<mediasoup.types.WebRtcTransport> {
    const transport = await router.createWebRtcTransport({
      listenIps: [
        {
          ip: this.listenIp,
          announcedIp: this.announcedIp
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: this.getInitialAvailableOutgoingBitrate()
    });

    if (this.maxIncomingBitrate !== null) {
      await transport.setMaxIncomingBitrate(this.maxIncomingBitrate);
    }

    this.realtimeDebug(
      `WebRTC transport created (ID: ${transport.id}, producing: ${options.producing}, consuming: ${options.consuming})`
    );

    return transport;
  }

  /**
   * Create a producer for audio/video
   */
  async createProducer(
    transport: mediasoup.types.WebRtcTransport,
    rtpParameters: mediasoup.types.RtpParameters,
    kind: mediasoup.types.MediaKind,
    appData?: Record<string, unknown>
  ): Promise<mediasoup.types.Producer> {
    const producer = await transport.produce({
      kind,
      rtpParameters,
      ...(appData !== undefined && Object.keys(appData).length > 0 ? { appData } : {})
    });

    const src =
      appData && typeof (appData as { source?: string }).source === "string"
        ? `, source: ${(appData as { source: string }).source}`
        : "";
    this.realtimeDebug(`Producer created (ID: ${producer.id}, kind: ${kind}${src})`);
    return producer;
  }

  /**
   * Create a consumer for receiving audio/video
   */
  async createConsumer(
    router: mediasoup.types.Router,
    transport: mediasoup.types.WebRtcTransport,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities,
    preferredLayers?: mediasoup.types.ConsumerLayers
  ): Promise<mediasoup.types.Consumer> {
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error("Cannot consume this producer");
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });

    if (preferredLayers && consumer.kind === "video") {
      await this.applyPreferredLayers(consumer, preferredLayers);
    }

    this.realtimeDebug(`Consumer created (ID: ${consumer.id}, producerId: ${producerId})`);
    return consumer;
  }

  async applyPreferredLayers(
    consumer: mediasoup.types.Consumer,
    preferredLayers?: mediasoup.types.ConsumerLayers
  ): Promise<void> {
    if (!preferredLayers || consumer.kind !== "video") return;
    try {
      await consumer.setPreferredLayers(preferredLayers);
      this.realtimeDebug(
        `Consumer ${consumer.id} preferred layers set to spatial=${preferredLayers.spatialLayer}, temporal=${preferredLayers.temporalLayer}`
      );
    } catch (error: any) {
      this.realtimeDebug(`Preferred layers ignored for consumer ${consumer.id}: ${error?.message || error}`);
    }
  }

  /**
   * Restart a worker with exponential backoff
   */
  private async restartWorker(workerIndex: number): Promise<void> {
    const attempts = this.workerRestartAttempts.get(workerIndex) || 0;
    
    if (attempts >= this.maxRestartAttempts) {
      this.logger.error(`Worker ${workerIndex} exceeded max restart attempts (${this.maxRestartAttempts}), giving up`);
      // Remove worker from pool but don't crash service
      this.workers[workerIndex] = null as any;
      return;
    }

    // Exponential backoff
    const backoffDelay = Math.min(
      this.restartBackoffBaseMs * Math.pow(2, attempts),
      this.restartBackoffMaxMs
    );
    
    this.workerRestartAttempts.set(workerIndex, attempts + 1);
    this.logger.log(`Restarting worker ${workerIndex} (attempt ${attempts + 1}/${this.maxRestartAttempts}) after ${backoffDelay}ms`);
    
    await new Promise(resolve => setTimeout(resolve, backoffDelay));

    try {
      const newWorker = await this.createWorkerAtIndex(workerIndex);

      this.workers[workerIndex] = newWorker;
      this.routersPerWorker.set(workerIndex, 0);
      this.workerRestartAttempts.delete(workerIndex); // Reset on successful restart
      this.logger.log(`✅ Worker ${workerIndex} restarted successfully (PID: ${newWorker.pid})`);
    } catch (error: any) {
      this.logger.error(`Failed to restart worker ${workerIndex}: ${error.message}`);
      // Will retry on next death event
    }
  }

  /**
   * Cleanup: close all workers
   */
  async onModuleDestroy() {
    this.logger.log("Closing all Mediasoup workers...");
    for (const worker of this.workers) {
      if (worker) {
        worker.close();
      }
    }
    this.logger.log("✅ All Mediasoup workers closed");
  }

  getLiveWorkerCount(): number {
    return this.workers.filter((worker) => worker && !worker.closed).length;
  }

  getWorkerStats() {
    return this.workers.map((worker, workerIndex) => {
      const portRange = this.getWorkerPortRange(workerIndex);
      return {
        workerIndex,
        pid: worker?.pid ?? null,
        closed: !worker || worker.closed,
        routerCount: this.routersPerWorker.get(workerIndex) ?? 0,
        rtcMinPort: portRange.rtcMinPort,
        rtcMaxPort: portRange.rtcMaxPort
      };
    });
  }
}
