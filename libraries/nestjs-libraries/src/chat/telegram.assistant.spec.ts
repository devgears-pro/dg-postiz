import { describe, expect, it, vi } from 'vitest';
import {
  formatTelegramHtml,
  splitTelegramMessage,
  verifyTelegramWebhookSecret,
} from './telegram.assistant.format';

describe('Telegram assistant helpers', () => {
  it('verifies webhook secret in constant time', () => {
    expect(verifyTelegramWebhookSecret('my-secret', 'my-secret')).toBe(true);
    expect(verifyTelegramWebhookSecret('my-secret', 'wrong-secret')).toBe(false);
    expect(verifyTelegramWebhookSecret('my-secret', undefined)).toBe(false);
    expect(verifyTelegramWebhookSecret(undefined, 'my-secret')).toBe(false);
  });

  it('escapes HTML and formats basic markdown safely for Telegram', () => {
    const html = formatTelegramHtml('Hello **world** & <script> `code`');
    expect(html).toContain('<b>world</b>');
    expect(html).toContain('&amp; &lt;script&gt;');
    expect(html).toContain('<code>code</code>');
  });

  it('splits messages exceeding Telegram 4096 character limit', () => {
    const longText = 'A'.repeat(5000);
    const chunks = splitTelegramMessage(longText, 4096);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBeLessThanOrEqual(4096);
    expect(chunks.join('')).toBe(longText);
  });
});

