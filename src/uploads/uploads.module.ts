import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadedAsset } from './entities/uploaded-asset.entity';
import { UploadsController } from './uploads.controller';
import { ObjectStorageService } from './object-storage.service';
import { UploadsSchemaService } from './uploads-schema.service';
import { UploadsService } from './uploads.service';

@Module({
  imports: [TypeOrmModule.forFeature([UploadedAsset])],
  controllers: [UploadsController],
  providers: [UploadsService, ObjectStorageService, UploadsSchemaService],
  exports: [UploadsService],
})
export class UploadsModule {}
