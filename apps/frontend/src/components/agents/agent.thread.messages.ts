import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

export type ThreadMessage = {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
};

type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;

type RawThreadMessage = {
  content: {
    content?: string;
    parts?: Array<{ type: string; text?: string }>;
  };
  role: 'user' | 'assistant' | 'system';
};

const CACHE_TTL = 30_000;
const CACHE_LIMIT = 10;

const cache = new Map<string, { at: number; messages: ThreadMessage[] }>();
const inflight = new Map<string, Promise<ThreadMessage[]>>();

const trimCache = () => {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (!oldest) return;
    cache.delete(oldest);
  }
};

const fetchThreadMessages = async (
  fetcher: Fetcher,
  id: string
): Promise<ThreadMessage[]> => {
  const response = await fetcher(`/copilot/${id}/list`);
  if (!response.ok) {
    throw new Error(`Could not load the conversation ${id}`);
  }

  const data = await response.json();
  const messages = ((data.messages as RawThreadMessage[]) || []).map((p) => ({
    id: makeId(12),
    content:
      p.content.content ||
      (p.content.parts || [])
        .map((part) => (part.type === 'text' ? part.text || '' : ''))
        .join(''),
    role: p.role,
  }));

  cache.set(id, { at: Date.now(), messages });
  trimCache();
  return messages;
};

export const loadThreadMessages = (
  fetcher: Fetcher,
  id: string
): Promise<ThreadMessage[]> => {
  const pending = inflight.get(id);
  if (pending) return pending;

  const request = fetchThreadMessages(fetcher, id).finally(() => {
    inflight.delete(id);
  });
  inflight.set(id, request);
  return request;
};

export const takeThreadMessages = (id: string): ThreadMessage[] | undefined => {
  const hit = cache.get(id);
  if (!hit) return undefined;
  cache.delete(id);
  if (Date.now() - hit.at > CACHE_TTL) return undefined;
  return hit.messages;
};

export const prefetchThreadMessages = (fetcher: Fetcher, id: string) => {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at <= CACHE_TTL) return;
  void loadThreadMessages(fetcher, id).catch(() => undefined);
};

export const forgetThreadMessages = (id: string) => {
  cache.delete(id);
  inflight.delete(id);
};
