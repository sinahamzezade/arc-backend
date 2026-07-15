import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadedAsset } from './entities/uploaded-asset.entity';

/** DB-backed storage for admin uploads. Keys are public URL paths. */
@Injectable()
export class UploadsService {
  constructor(
    @InjectRepository(UploadedAsset)
    private readonly repo: Repository<UploadedAsset>,
  ) {}

  async put(key: string, mime: string, data: Buffer): Promise<void> {
    const existing = await this.repo.findOne({ where: { key } });
    if (existing) {
      existing.mime = mime;
      existing.data = data;
      await this.repo.save(existing);
      return;
    }
    await this.repo.save(this.repo.create({ key, mime, data }));
  }

  async get(key: string): Promise<UploadedAsset | null> {
    return this.repo.findOne({ where: { key } });
  }

  async remove(key: string): Promise<void> {
    await this.repo.delete({ key });
  }
}
