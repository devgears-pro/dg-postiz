import { describe, expect, it } from 'vitest';
import {
  DOCS_MAX_FILE_BYTES,
  normalizeDocPath,
  sanitizeDocName,
  validateAndDetectDoc,
} from './docs.validation';

describe('docs.validation', () => {
  it('sanitizes valid names and rejects unsafe names', () => {
    expect(sanitizeDocName('  brand-guide.md  ')).toBe('brand-guide.md');

    for (const bad of ['', '   ', '.', '..', '.hidden', 'a/b', 'a\\b', 'a\x00b', 'a\nb', 'x'.repeat(181)]) {
      expect(() => sanitizeDocName(bad)).toThrow();
    }
  });

  it('normalizes paths and blocks traversal or dot-prefixed segments', () => {
    expect(normalizeDocPath()).toBe('/');
    expect(normalizeDocPath('brandbook\\2026\\guide.md')).toBe(
      '/brandbook/2026/guide.md'
    );

    for (const bad of ['/../etc/passwd', '/a/../../b', '/.hidden/file.txt', '/a\x07b']) {
      expect(() => normalizeDocPath(bad)).toThrow();
    }
  });

  it('rejects empty, oversized, invalid UTF-8, and unsafe SVG payloads', async () => {
    await expect(
      validateAndDetectDoc('empty.txt', Buffer.alloc(0))
    ).rejects.toThrow();

    await expect(
      validateAndDetectDoc('huge.txt', Buffer.alloc(DOCS_MAX_FILE_BYTES + 1, 0x41))
    ).rejects.toThrow();

    await expect(
      validateAndDetectDoc('binary.txt', Buffer.from([0xff, 0xfe, 0xfd]))
    ).rejects.toThrow();

    for (const badSvg of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><foreignObject><div>x</div></foreignObject></svg>',
      '<svg><a href="javascript:alert(1)">x</a></svg>',
    ]) {
      await expect(
        validateAndDetectDoc('xss.svg', Buffer.from(badSvg, 'utf8'))
      ).rejects.toThrow();
    }
  });
});
