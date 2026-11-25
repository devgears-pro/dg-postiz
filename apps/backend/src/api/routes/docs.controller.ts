import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { DocsService } from '@gitroom/nestjs-libraries/docs/docs.service';
import { DOCS_MAX_FILE_BYTES } from '@gitroom/nestjs-libraries/docs/docs.validation';

@ApiTags('Documents')
@Controller('/documents')
export class DocsController {
  constructor(private readonly _docsService: DocsService) {}

  @Get('/')
  async list(
    @GetOrgFromRequest() org: Organization,
    @Query('path') path = '/',
    @Query('recursive') recursive = 'false'
  ) {
    const items = await this._docsService.list(
      org.id,
      path,
      recursive === 'true'
    );
    return { items };
  }

  @Post('/folder')
  async createFolder(
    @GetOrgFromRequest() org: Organization,
    @Body('path') path: string
  ) {
    if (!path || typeof path !== 'string') {
      throw new BadRequestException('Folder path is required');
    }
    return this._docsService.createFolder(org.id, path);
  }

  @Post('/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: DOCS_MAX_FILE_BYTES },
    })
  )
  async upload(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File,
    @Body('path') folderPath = '/'
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this._docsService.uploadFile(
      org.id,
      typeof folderPath === 'string' ? folderPath : '/',
      file.originalname,
      file.buffer
    );
  }

  @Patch('/rename')
  @HttpCode(200)
  async rename(
    @GetOrgFromRequest() org: Organization,
    @Body('path') path: string,
    @Body('newName') newName: string
  ) {
    if (!path || typeof path !== 'string' || !newName || typeof newName !== 'string') {
      throw new BadRequestException('Both path and newName are required');
    }
    return this._docsService.rename(org.id, path, newName);
  }

  @Get('/file')
  async getFile(
    @GetOrgFromRequest() org: Organization,
    @Query('path') path: string,
    @Query('download') download: string | undefined,
    @Res() res: Response
  ) {
    if (!path || typeof path !== 'string') {
      throw new BadRequestException('File path is required');
    }
    const { buffer, entry } = await this._docsService.readFile(org.id, path);
    const mimeType = entry.mimeType ?? 'application/octet-stream';
    const encodedName = encodeURIComponent(entry.name);
    const dispositionType =
      download === 'true' || mimeType === 'image/svg+xml'
        ? 'attachment'
        : 'inline';
    const disposition = `${dispositionType}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'; frame-ancestors 'none'; sandbox"
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', disposition);
    res.send(buffer);
  }

  @Delete('/')
  async delete(
    @GetOrgFromRequest() org: Organization,
    @Query('path') path: string
  ) {
    if (!path || typeof path !== 'string') {
      throw new BadRequestException('Path is required');
    }
    await this._docsService.delete(org.id, path);
    return { deleted: true };
  }
}
