import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import * as mediasoup from "mediasoup";

@Injectable()
export class MediasoupService implements OnModuleInit {
  private readonly logger = new Logger(MediasoupService.name);
  private workers: mediasoup.types.Worker[] = [];
  private workerRestartAttempts: Map<number, number> = new Map(); // Track restart attempts per worker index
  private nextWorkerIndex = 0;
  private readonly numWorkers: number;
  private readonly listenIp: string;
  private readonly announcedIp: string;
  private readonly MAX_RESTART_ATTEMPTS = 5;
  private readonly RESTART_BACKOFF_BASE = 2000; // 2 seconds base delay

  constructor() {
    this.numWorkers = parseInt(process.env.MEDIASOUP_WORKERS || "4", 10);
    this.listenIp = process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0";
    this.announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";
  }

  async onModuleInit() {
    this.logger.log(`Creating ${this.numWorkers} Mediasoup workers...`);
    
    for (let i = 0; i < this.numWorkers; i++) {
      try {
        const worker = await mediasoup.createWorker({
          logLevel: "warn",
          logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
          rtcMinPort: 40000,
          rtcMaxPort: 49999
        });

        worker.on("died", () => {
          this.logger.error(`Mediasoup worker ${i} died, attempting to restart...`);
          this.restartWorker(i).catch(err => {
            this.logger.error(`Failed to restart worker ${i}: ${err.message}`);
          });
        });

        this.workers.push(worker);
        this.logger.log(`Mediasoup worker ${i} created (PID: ${worker.pid})`);
      } catch (error) {
        this.logger.error(`Failed to create Mediasoup worker ${i}:`, error);
        throw error;
      }
    }

    this.logger.log(`✅ All ${this.numWorkers} Mediasoup workers created successfully`);
  }

  /**
   * Get the next available worker (round-robin)
   */
  private getNextWorker(): mediasoup.types.Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  /**
   * Create a new router for a room
   */
  async createRouter(): Promise<mediasoup.types.Router> {
    const worker = this.getNextWorker();
    
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

    this.logger.log(`Router created (ID: ${router.id})`);
    return router;
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
      initialAvailableOutgoingBitrate: 1000000
    });

    this.logger.log(
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
    kind: mediasoup.types.MediaKind
  ): Promise<mediasoup.types.Producer> {
    const producer = await transport.produce({
      kind,
      rtpParameters
    });

    this.logger.log(`Producer created (ID: ${producer.id}, kind: ${kind})`);
    return producer;
  }

  /**
   * Create a consumer for receiving audio/video
   */
  async createConsumer(
    router: mediasoup.types.Router,
    transport: mediasoup.types.WebRtcTransport,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities
  ): Promise<mediasoup.types.Consumer> {
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error("Cannot consume this producer");
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });

    this.logger.log(`Consumer created (ID: ${consumer.id}, producerId: ${producerId})`);
    return consumer;
  }

  /**
   * Restart a worker with exponential backoff
   */
  private async restartWorker(workerIndex: number): Promise<void> {
    const attempts = this.workerRestartAttempts.get(workerIndex) || 0;
    
    if (attempts >= this.MAX_RESTART_ATTEMPTS) {
      this.logger.error(`Worker ${workerIndex} exceeded max restart attempts (${this.MAX_RESTART_ATTEMPTS}), giving up`);
      // Remove worker from pool but don't crash service
      this.workers[workerIndex] = null as any;
      return;
    }

    // Exponential backoff: 2s, 4s, 8s, 16s, 32s
    const backoffDelay = Math.min(
      this.RESTART_BACKOFF_BASE * Math.pow(2, attempts),
      32000
    );
    
    this.workerRestartAttempts.set(workerIndex, attempts + 1);
    this.logger.log(`Restarting worker ${workerIndex} (attempt ${attempts + 1}/${this.MAX_RESTART_ATTEMPTS}) after ${backoffDelay}ms`);
    
    await new Promise(resolve => setTimeout(resolve, backoffDelay));

    try {
      const newWorker = await mediasoup.createWorker({
        logLevel: "warn",
        logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
        rtcMinPort: 40000,
        rtcMaxPort: 49999
      });

      newWorker.on("died", () => {
        this.logger.error(`Mediasoup worker ${workerIndex} died again, will retry...`);
        this.restartWorker(workerIndex).catch(err => {
          this.logger.error(`Failed to restart worker ${workerIndex}: ${err.message}`);
        });
      });

      this.workers[workerIndex] = newWorker;
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
}
