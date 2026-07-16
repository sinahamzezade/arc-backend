import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadedAsset } from './entities/uploaded-asset.entity';
import { UploadsController } from './uploads.controller';
import { ObjectStorageService } from './object-storage.service';
import { UploadsService } from './uploads.service';

@Module({
  imports: [TypeOrmModule.forFeature([UploadedAsset])],
  controllers: [UploadsController],
  providers: [UploadsService, ObjectStorageService],
  exports: [UploadsService],
})
export class UploadsModule {}
