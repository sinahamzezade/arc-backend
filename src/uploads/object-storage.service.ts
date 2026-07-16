import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export type StoredAsset = {
  key: string;
  mime: string;
  data: Buffer;
  storage: 'db' | 's3';
};

@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  private readonly publicBaseUrl: string | null;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT')?.trim();
    const region = config.get<string>('S3_REGION')?.trim() || 'auto';
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY')?.trim();
    this.bucket = config.get<string>('S3_BUCKET')?.trim() || null;
    this.publicBaseUrl = config.get<string>('S3_PUBLIC_BASE_URL')?.trim() || null;

    if (this.bucket && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region,
        endpoint: endpoint || undefined,
        forcePathStyle: Boolean(endpoint),
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.client = null;
    }
  }

  get enabled(): boolean {
    return this.client != null && this.bucket != null;
  }

  publicUrl(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl.replace(/\/$/, '')}${key}`;
  }

  async put(key: string, mime: string, data: Buffer): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new Error('Object storage is not configured');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key.replace(/^\//, ''),
        Body: data,
        ContentType: mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    if (!this.client || !this.bucket) return null;
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key.replace(/^\//, ''),
        }),
      );
      if (!res.Body) return null;
      return await streamToBuffer(res.Body as Readable);
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    if (!this.client || !this.bucket) return;
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key.replace(/^\//, ''),
      }),
    );
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
