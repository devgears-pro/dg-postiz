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
  });
});
