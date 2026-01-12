import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { FilesController } from "../routes/files.controller.js";
import { FilesService } from "../services/files.service.js";
import { R2Service } from "../services/r2.service.js";
import { ImageProcessingService } from "../services/image-processing.service.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [FilesController],
  providers: [PrismaService, FilesService, R2Service, ImageProcessingService]
})
export class AppModule {}
