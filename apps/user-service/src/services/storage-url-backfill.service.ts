import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { rewrittenStorageUrlOrNull } from "@hmm/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class StorageUrlBackfillService implements OnModuleInit {
  private readonly logger = new Logger(StorageUrlBackfillService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.rewriteExpiredUrls();
  }

  private async rewriteExpiredUrls() {
    try {
      let updated = 0;
      updated += await this.rewriteColumn(
        () =>
          (this.prisma as any).discoveryCityOption.findMany({
            select: { id: true, faceCardImageUrl: true }
          }),
        (id, url) =>
          (this.prisma as any).discoveryCityOption.update({
            where: { id },
            data: { faceCardImageUrl: url }
          }),
        "faceCardImageUrl"
      );
      updated += await this.rewriteColumn(
        () =>
          (this.prisma as any).zodiac.findMany({
            select: { id: true, imageUrl: true }
          }),
        (id, url) =>
          (this.prisma as any).zodiac.update({
            where: { id },
            data: { imageUrl: url }
          }),
        "imageUrl"
      );
      updated += await this.rewriteColumn(
        () =>
          this.prisma.brand.findMany({
            select: { id: true, logoUrl: true }
          }),
        (id, url) =>
          this.prisma.brand.update({
            where: { id },
            data: { logoUrl: url }
          }),
        "logoUrl"
      );
      updated += await this.rewriteColumn(
        () =>
          this.prisma.user.findMany({
            where: { displayPictureUrl: { not: null } },
            select: { id: true, displayPictureUrl: true }
          }),
        (id, url) =>
          this.prisma.user.update({
            where: { id },
            data: { displayPictureUrl: url }
          }),
        "displayPictureUrl"
      );
      updated += await this.rewriteColumn(
        () =>
          this.prisma.userPhoto.findMany({
            select: { id: true, url: true }
          }),
        (id, url) =>
          this.prisma.userPhoto.update({
            where: { id },
            data: { url }
          }),
        "url"
      );
      updated += await this.rewriteColumn(
        () =>
          (this.prisma as any).moderatorFaceCardSetting.findMany({
            select: { id: true, displayPictureUrl: true }
          }),
        (id, url) =>
          (this.prisma as any).moderatorFaceCardSetting.update({
            where: { id },
            data: { displayPictureUrl: url }
          }),
        "displayPictureUrl"
      );

      if (updated > 0) {
        this.logger.log(`Rewrote ${updated} expired storage URL(s) to public B2 URLs`);
      }
    } catch (error: any) {
      this.logger.warn(`Storage URL rewrite skipped: ${error?.message || error}`);
    }
  }

  private async rewriteColumn(
    load: () => Promise<Array<Record<string, any>>>,
    update: (id: string, url: string) => Promise<unknown>,
    field: string
  ): Promise<number> {
    const rows = await load();
    let updated = 0;
    for (const row of rows) {
      const next = rewrittenStorageUrlOrNull(row[field]);
      if (!next) continue;
      await update(row.id, next);
      updated++;
    }
    return updated;
  }
}
