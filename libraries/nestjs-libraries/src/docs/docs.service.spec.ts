import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDocsStorage } from './local.docs.storage';
import { DocsService } from './docs.service';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('DocsService', () => {
  let rootDir: string;
  let service: DocsService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'postiz-docs-service-'));
    service = new DocsService(new LocalDocsStorage(rootDir));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('reads text files with offset pagination and returns image buffers for raster images', async () => {
    await service.uploadFile(
      'org-1',
      '/',
      'long.txt',
      Buffer.from('A'.repeat(150), 'utf8')
    );
    const page1 = await service.readForAgent('org-1', '/long.txt', 0, 100);
    expect(page1.kind).toBe('text');
    if (page1.kind === 'text') {
      expect(page1.content.length).toBe(100);
      expect(page1.hasMore).toBe(true);
    }

    const page2 = await service.readForAgent('org-1', '/long.txt', 100, 100);
    if (page2.kind === 'text') {
      expect(page2.content.length).toBe(50);
      expect(page2.hasMore).toBe(false);
    }

    await service.uploadFile('org-1', '/', 'brand.png', PNG_1X1);
    const img = await service.readForAgent('org-1', '/brand.png');
    expect(img.kind).toBe('image');
    if (img.kind === 'image') {
      expect(img.mimeType).toBe('image/png');
      expect(img.buffer.equals(PNG_1X1)).toBe(true);
    }

    await service.uploadFile(
      'org-1',
      '/',
      'icon.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
    );
    const svg = await service.readForAgent('org-1', '/icon.svg', Number.NaN, Number.NaN);
    expect(svg.kind).toBe('text');
  });

  it('forbids changing file extension on rename and handles corrupt pdf/docx', async () => {
    await service.uploadFile(
      'org-1',
      '/',
      'notes.txt',
      Buffer.from('hello', 'utf8')
    );
    await expect(
      service.rename('org-1', '/notes.txt', 'notes.md')
    ).rejects.toThrow('Cannot change file extension');

    const renamed = await service.rename('org-1', '/notes.txt', 'updated.txt');
    expect(renamed.path).toBe('/updated.txt');

    const storage = new LocalDocsStorage(rootDir);
    await storage.writeFile('org-1', '/broken.pdf', Buffer.from('%PDF-broken', 'utf8'));
    await expect(service.readForAgent('org-1', '/broken.pdf')).rejects.toThrow(
      'Could not extract text from PDF document'
    );

    await storage.writeFile('org-1', '/broken.docx', Buffer.from('not-a-zip', 'utf8'));
    await expect(service.readForAgent('org-1', '/broken.docx')).rejects.toThrow(
      'Could not extract text from DOCX document'
    );

    await storage.writeFile('org-1', '/big.png', Buffer.alloc(10 * 1024 * 1024 + 1, 0));
    await expect(service.readForAgent('org-1', '/big.png')).rejects.toThrow(
      'Image exceeds maximum size'
    );
  });
});
