import {
  Controller,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { MiningService, type CoinMiningBucket } from "../services/mining.service.js";
import { z } from "zod";

const BucketSchema = z.enum(["BROADCAST", "VIDEO_CALL", "VIEWER"]);

const StartSessionSchema = z.object({
  userId: z.string().min(1),
  bucket: BucketSchema,
  roomId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable()
});

const StopSessionSchema = z.object({
  userId: z.string().min(1),
  bucket: BucketSchema.optional().nullable(),
  roomId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable()
});

const FaceCardCompleteSchema = z.object({
  userId: z.string().min(1),
  referrerId: z.string().min(1).optional().nullable()
});

@Controller()
export class MiningController {
  constructor(private readonly miningService: MiningService) {}

  private assertInternalRequest(internalToken?: string) {
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expectedToken) {
      throw new HttpException(
        "INTERNAL_SERVICE_TOKEN is not configured",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (!internalToken || internalToken !== expectedToken) {
      throw new HttpException("Unauthorized internal request", HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * POST /internal/mining/session/start
   */
  @Post("internal/mining/session/start")
  async startSession(
    @Body() body: unknown,
    @Headers("x-internal-token") internalToken?: string
  ) {
    this.assertInternalRequest(internalToken);
    const dto = StartSessionSchema.parse(body);
    return this.miningService.startSession({
      userId: dto.userId,
      bucket: dto.bucket as CoinMiningBucket,
      roomId: dto.roomId,
      sessionId: dto.sessionId
    });
  }

  /**
   * POST /internal/mining/session/stop
   */
  @Post("internal/mining/session/stop")
  async stopSession(
    @Body() body: unknown,
    @Headers("x-internal-token") internalToken?: string
  ) {
    this.assertInternalRequest(internalToken);
    const dto = StopSessionSchema.parse(body);
    return this.miningService.stopSession({
      userId: dto.userId,
      bucket: (dto.bucket as CoinMiningBucket | null | undefined) ?? null,
      roomId: dto.roomId ?? null,
      sessionId: dto.sessionId ?? null
    });
  }

  /**
   * POST /internal/mining/facecard-complete
   */
  @Post("internal/mining/facecard-complete")
  async faceCardComplete(
    @Body() body: unknown,
    @Headers("x-internal-token") internalToken?: string
  ) {
    this.assertInternalRequest(internalToken);
    const dto = FaceCardCompleteSchema.parse(body);
    return this.miningService.awardFaceCardComplete({
      userId: dto.userId,
      referrerId: dto.referrerId
    });
  }
}
