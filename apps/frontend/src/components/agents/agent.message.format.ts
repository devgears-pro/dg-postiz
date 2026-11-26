type MessagePart = {
  type?: string;
  text?: unknown;
};

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
              if (!part || typeof part !== 'object') {
                return '';
              }
              const typed = part as MessagePart;
              return typed.type === 'text' ? String(typed.text ?? '') : '';
            })
            .join('')
        : '';

  return escapeHtml(text)
    .replace(/Video: (http.*mp4\n)/g, (_match, source: string) => {
      return `<video controls class="h-[150px] w-[150px] rounded-[8px] mb-[10px]"><source src="${source.trim()}" type="video/mp4">Your browser does not support the video tag.</video>`;
    })
    .replace(/Image: (http\S+) \(media [^)]+\)/g, (_match, source: string) => {
      return `<img src="${source.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
    })
    .replace(/Image: (http.*\n)/g, (_match, source: string) => {
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
