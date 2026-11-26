import { describe, expect, it } from 'vitest';
import { formatUserMessageContent } from './agent.message.format';

describe('formatUserMessageContent', () => {
  it('escapes user HTML before rendering media markers', () => {
    const html = formatUserMessageContent(
      '<img src=x onerror="alert(1)">'
    );

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renders a media image without allowing attribute injection', () => {
    const html = formatUserMessageContent(
      'Image: https://cdn.example/a.png (media 1)'
    );

    expect(html).toContain('<img src="https://cdn.example/a.png"');
    expect(html).not.toContain('onerror="');
  });

  it('does not double-escape document names', () => {
    const html = formatUserMessageContent(
      '[--Docs--]\nDocument: /docs/a&b.pdf\n[--Docs--]'
    );

    expect(html).toContain('/docs/a&amp;b.pdf');
    expect(html).not.toContain('&amp;amp;');
  });
});
