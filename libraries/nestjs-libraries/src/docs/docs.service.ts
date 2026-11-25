import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { extname, posix } from 'node:path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import {
  DOCS_STORAGE,
  type DocEntry,
  type IDocsStorage,
} from './docs.storage.interface';
import {
  isImageDocExtension,
  isTextDocExtension,
  normalizeDocPath,
  validateAndDetectDoc,
} from './docs.validation';

export type DocReadResult =
  | {
      kind: 'text';
      path: string;
      mimeType: string;
      totalLength: number;
      offset: number;
      hasMore: boolean;
      content: string;
    }
  | {
      kind: 'image';
      path: string;
      mimeType: string;
      buffer: Buffer;
    };

const DEFAULT_READ_LIMIT = 24_000;

@Injectable()
export class DocsService {
  constructor(@Inject(DOCS_STORAGE) private readonly _storage: IDocsStorage) {}

  list(orgId: string, dirPath = '/', recursive = false): Promise<DocEntry[]> {
    return this._storage.list(orgId, dirPath, recursive);
  }

  createFolder(orgId: string, folderPath: string): Promise<DocEntry> {
    return this._storage.createFolder(orgId, folderPath);
  }

  async uploadFile(
    orgId: string,
    folderPath: string,
    originalName: string,
    buffer: Buffer
  ): Promise<DocEntry> {
    const { safeName } = await validateAndDetectDoc(originalName, buffer);
    const parent = normalizeDocPath(folderPath);
    const targetPath =
      parent === '/' ? `/${safeName}` : posix.join(parent, safeName);
    return this._storage.writeFile(orgId, targetPath, buffer);
  }

  readFile(
    orgId: string,
    filePath: string
  ): Promise<{ buffer: Buffer; entry: DocEntry }> {
    return this._storage.readFile(orgId, filePath);
  }

  rename(orgId: string, targetPath: string, newName: string): Promise<DocEntry> {
    return this._storage.rename(orgId, targetPath, newName);
  }

  delete(orgId: string, targetPath: string): Promise<void> {
    return this._storage.delete(orgId, targetPath);
  }

  async readForAgent(
    orgId: string,
    filePath: string,
    offset = 0,
    limit = DEFAULT_READ_LIMIT
  ): Promise<DocReadResult> {
    const { buffer, entry } = await this._storage.readFile(orgId, filePath);
    const ext = extname(entry.path).toLowerCase();
    const mimeType = entry.mimeType ?? 'application/octet-stream';

    if (isImageDocExtension(ext)) {
      return {
        kind: 'image',
        path: entry.path,
        mimeType,
        buffer,
      };
    }

    let fullText: string;
    if (isTextDocExtension(ext)) {
      fullText = buffer.toString('utf8');
    } else if (ext === '.pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        fullText = result.text;
      } finally {
        await parser.destroy();
      }
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      fullText = result.value;
    } else {
      throw new BadRequestException(`Unsupported document format: ${ext}`);
    }

    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(Math.max(100, limit), 60_000);
    const slice = fullText.slice(safeOffset, safeOffset + safeLimit);
    return {
      kind: 'text',
      path: entry.path,
      mimeType,
      totalLength: fullText.length,
      offset: safeOffset,
      hasMore: safeOffset + slice.length < fullText.length,
      content: slice,
    };
  }
}
