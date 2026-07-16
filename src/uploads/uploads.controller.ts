import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UploadsService } from './uploads.service';

const SCOPES = new Set(['ranks', 'badges', 'avatars']);

/**
 * Serves DB-stored uploads at /uploads/:scope/:name.
 * Express static (public/uploads) runs first, so legacy disk files still win;
 * this is the fallback that survives ephemeral filesystems (Railway).
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get(':scope/:name')
  async serve(
    @Param('scope') scope: string,
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    if (!SCOPES.has(scope) || name.includes('..') || name.includes('/')) {
      throw new NotFoundException();
    }
    const asset = await this.uploads.get(`/uploads/${scope}/${name}`);
    if (!asset) throw new NotFoundException();
    res.setHeader('Content-Type', asset.mime);
    // Filenames contain a random hash, so content at a given URL never changes.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(asset.data);
  }
}
