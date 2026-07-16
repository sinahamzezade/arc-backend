import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadedAsset } from './entities/uploaded-asset.entity';
import { ObjectStorageService } from './object-storage.service';

/** Hybrid storage: S3/R2 when configured, Postgres bytea fallback. */
@Injectable()
export class UploadsService {
  constructor(
    @InjectRepository(UploadedAsset)
    private readonly repo: Repository<UploadedAsset>,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async put(key: string, mime: string, data: Buffer): Promise<void> {
    const useS3 = this.objectStorage.enabled;
    const existing = await this.repo.findOne({ where: { key } });
    if (useS3) {
      await this.objectStorage.put(key, mime, data);
    }

    if (existing) {
      existing.mime = mime;
      existing.storage = useS3 ? 's3' : 'db';
      existing.data = useS3 ? null : data;
      await this.repo.save(existing);
      return;
    }

    await this.repo.save(
      this.repo.create({
        key,
        mime,
        storage: useS3 ? 's3' : 'db',
        data: useS3 ? null : data,
      }),
    );
  }

  async get(key: string): Promise<UploadedAsset | null> {
    const row = await this.repo.findOne({ where: { key } });
    if (!row) return null;

    if (row.storage === 's3') {
      const data = await this.objectStorage.get(key);
      if (!data) return null;
      return { ...row, data };
    }

    if (!row.data) return null;
    return row;
  }

  async remove(key: string): Promise<void> {
    const row = await this.repo.findOne({ where: { key } });
    if (row?.storage === 's3') {
      await this.objectStorage.remove(key);
    }
    await this.repo.delete({ key });
  }
}
