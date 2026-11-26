type MessagePart = {
  type?: string;
  text?: unknown;
};

const isMessagePart = (part: unknown): part is MessagePart =>
  Boolean(part) && typeof part === 'object';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function formatUserMessageContent(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => {
              if (!isMessagePart(part)) {
                return '';
              }
              return part.type === 'text' ? String(part.text ?? '') : '';
            })
            .join('')
        : '';

  return escapeHtml(text)
    .replace(/Video: ((?:https?:\/\/|\/)\S+\.mp4)/g, (_match, source: string) => {
      return `<video controls class="h-[150px] w-[150px] rounded-[8px] mb-[10px]"><source src="${source.trim()}" type="video/mp4">Your browser does not support the video tag.</video>`;
    })
    .replace(/Image: ((?:https?:\/\/|\/)\S+) \(media [^)]+\)/g, (_match, source: string) => {
      return `<img src="${source.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
    })
    .replace(/Image: ((?:https?:\/\/|\/)\S+)/g, (_match, source: string) => {
      return `<img src="${source.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
    })
    .replace(/\[\-\-Media\-\-\](.*)\[\-\-Media\-\-\]/g, (_match, body: string) => {
      return `<div class="flex justify-center mt-[20px]">${body}</div>`;
    })
    .replace(
      /\[\-\-Docs\-\-\]([\s\S]*?)\[\-\-Docs\-\-\]/g,
      (_match, body: string) => {
        return `<div class="mt-[8px] text-[12px] opacity-80">${body}</div>`;
      }
    )
    .replace(/(\[--integrations--\][\s\S]*?\[--integrations--\])/g, () => '')
    .replace(/\[--Media--\]/g, '')
    .replace(/\[--Docs--\]/g, '');
}
