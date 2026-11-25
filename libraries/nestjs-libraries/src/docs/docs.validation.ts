import { BadRequestException } from '@nestjs/common';
import { extname, posix } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileTypeFromBuffer } = require('file-type') as {
  fileTypeFromBuffer: (
    buffer: Buffer
  ) => Promise<{ ext: string; mime: string } | undefined>;
};

export const DOCS_MAX_FILE_BYTES = 20 * 1024 * 1024;

export const DOCS_EXTENSION_MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const BINARY_SNIFF_MIMES: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif'],
};

export function isImageDocExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isTextDocExtension(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext.toLowerCase()) || ext.toLowerCase() === '.svg';
}

export function mimeForDocPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return DOCS_EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

export function normalizeDocPath(rawPath?: string): string {
  const raw = (rawPath ?? '/').trim().replace(/\\/g, '/');
  if (raw.includes('\0')) {
    throw new BadRequestException('Invalid path');
  }
  const segments = raw.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) {
    throw new BadRequestException('Path traversal is not allowed');
  }
  return '/' + posix.join(...segments).replace(/^\.$/, '');
}

export function sanitizeDocName(rawName: string): string {
  const name = rawName.trim();
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.startsWith('.') ||
    /[/\\\0]/.test(name) ||
    name.length > 180
  ) {
    throw new BadRequestException('Invalid file or folder name');
  }
  return name;
}

function isValidUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

export async function validateAndDetectDoc(
  originalName: string,
  buffer: Buffer
): Promise<{ safeName: string; ext: string; mimeType: string }> {
  const safeName = sanitizeDocName(originalName);
  const ext = extname(safeName).toLowerCase();
  const declaredMime = DOCS_EXTENSION_MIME[ext];
  if (!declaredMime) {
    throw new BadRequestException(`Unsupported file type: ${ext || 'unknown'}`);
  }
  if (buffer.length === 0) {
    throw new BadRequestException('Empty files are not allowed');
  }
  if (buffer.length > DOCS_MAX_FILE_BYTES) {
    throw new BadRequestException('File exceeds maximum allowed size (20 MB)');
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    if (!isValidUtf8Text(buffer)) {
      throw new BadRequestException('File content is not valid UTF-8 text');
    }
    return { safeName, ext, mimeType: declaredMime };
  }

  if (ext === '.svg') {
    if (!isValidUtf8Text(buffer)) {
      throw new BadRequestException('Invalid SVG file');
    }
    const text = buffer.toString('utf8');
    if (!/<svg[\s>]/i.test(text)) {
      throw new BadRequestException('File content is not a valid SVG');
    }
    return { safeName, ext, mimeType: declaredMime };
  }

  const detected = await fileTypeFromBuffer(buffer);
  const allowedMimes = BINARY_SNIFF_MIMES[ext] ?? [];
  if (!detected || !allowedMimes.includes(detected.mime)) {
    throw new BadRequestException(
      'File content does not match the declared extension'
    );
  }

  return { safeName, ext, mimeType: declaredMime };
}
