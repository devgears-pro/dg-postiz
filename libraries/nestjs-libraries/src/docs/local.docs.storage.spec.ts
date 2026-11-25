import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDocsStorage } from './local.docs.storage';
import { validateAndDetectDoc } from './docs.validation';

describe('LocalDocsStorage and validation', () => {
  let rootDir: string;
  let storage: LocalDocsStorage;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'postiz-docs-test-'));
    storage = new LocalDocsStorage(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('creates folders, writes files, lists recursively, renames folders, and deletes items', async () => {
    await storage.createFolder('org-a', '/brandbook');
    await storage.writeFile(
      'org-a',
      '/brandbook/guide.md',
      Buffer.from('# Brand Guide\n', 'utf8')
    );

    const items = await storage.list('org-a', '/', true);
    expect(items.map((item) => item.path)).toEqual([
      '/brandbook',
      '/brandbook/guide.md',
    ]);

    const renamed = await storage.rename('org-a', '/brandbook', 'brand-kit');
    expect(renamed.path).toBe('/brand-kit');

    const afterRename = await storage.list('org-a', '/', true);
    expect(afterRename.map((item) => item.path)).toEqual([
      '/brand-kit',
      '/brand-kit/guide.md',
    ]);

    await storage.delete('org-a', '/brand-kit/guide.md');
    await storage.delete('org-a', '/brand-kit');
    const afterDelete = await storage.list('org-a', '/', true);
    expect(afterDelete).toEqual([]);
  });

  it('isolates organizations and blocks path traversal', async () => {
    await storage.writeFile(
      'org-a',
      '/secret.md',
      Buffer.from('Org A secret', 'utf8')
    );

    expect(await storage.list('org-b', '/', true)).toEqual([]);
    await expect(storage.readFile('org-b', '/secret.md')).rejects.toThrow();
    await expect(
      storage.readFile('org-a', '/../../org-b/secret.md')
    ).rejects.toThrow();
  });

  it('validates allowed extensions and rejects mismatched binary signatures', async () => {
    const validMd = await validateAndDetectDoc(
      'notes.md',
      Buffer.from('# Notes', 'utf8')
    );
    expect(validMd.mimeType).toBe('text/markdown');

    const validSvg = await validateAndDetectDoc(
      'logo.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
    );
    expect(validSvg.mimeType).toBe('image/svg+xml');

    await expect(
      validateAndDetectDoc('bad.exe', Buffer.from('MZ', 'utf8'))
    ).rejects.toThrow();
    await expect(
      validateAndDetectDoc('fake.pdf', Buffer.from('not a pdf', 'utf8'))
    ).rejects.toThrow();
  });
});
