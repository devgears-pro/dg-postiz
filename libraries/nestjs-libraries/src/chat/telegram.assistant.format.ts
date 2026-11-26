import { timingSafeEqual } from 'crypto';

export function verifyTelegramWebhookSecret(
  expectedSecret: string | undefined,
  headerSecret: string | undefined
): boolean {
  if (!expectedSecret || !headerSecret) {
    return false;
  }
  const expectedBuf = Buffer.from(expectedSecret, 'utf8');
  const headerBuf = Buffer.from(headerSecret, 'utf8');
  if (expectedBuf.length !== headerBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, headerBuf);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInlineMarkdown(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<i>$2</i>');
}

export function formatTelegramHtml(markdown: string): string {
  const codeBlocks: string[] = [];
  const withPlaceholders = markdown.replace(
    /```(?:\w+)?\n?([\s\S]*?)```/g,
    (_match, code: string) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre>${escapeHtml(code.trimEnd())}</pre>`);
      return `@@CODEBLOCK_${idx}@@`;
    }
  );

  const inlineCodes: string[] = [];
  const withInlinePlaceholders = withPlaceholders.replace(
    /`([^`\n]+)`/g,
    (_match, code: string) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
      return `@@INLINECODE_${idx}@@`;
    }
  );

  const escaped = escapeHtml(withInlinePlaceholders);
  const formatted = formatInlineMarkdown(escaped)
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/@@INLINECODE_(\d+)@@/g, (_m, idx: string) => inlineCodes[Number(idx)] ?? '')
    .replace(/@@CODEBLOCK_(\d+)@@/g, (_m, idx: string) => codeBlocks[Number(idx)] ?? '');

  return formatted;
}

export function splitTelegramMessage(text: string, maxLength = 4096): string[] {
  if (!text) {
    return [];
  }
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0 || splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt <= 0 || splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

