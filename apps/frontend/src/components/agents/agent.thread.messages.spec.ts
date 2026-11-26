import { describe, expect, it, vi } from 'vitest';
import {
  forgetThreadMessages,
  loadThreadMessages,
  takeThreadMessages,
} from './agent.thread.messages';

const message = { content: { content: 'Hello' }, role: 'user' as const };

const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body } as Response);

describe('agent thread message cache', () => {
  it('does not cache a failed response', async () => {
    const fetcher = vi.fn(async () => response({}, false));

    await expect(loadThreadMessages(fetcher, 'thread-1')).rejects.toThrow();
    expect(takeThreadMessages('thread-1')).toBeUndefined();
  });

  it('shares an in-flight request and consumes the cached result once', async () => {
    const fetcher = vi.fn(async () => response({ messages: [message] }));

    const first = loadThreadMessages(fetcher, 'thread-1');
    const second = loadThreadMessages(fetcher, 'thread-1');
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(secondResult).toEqual(firstResult);
    expect(takeThreadMessages('thread-1')).toEqual(firstResult);
    expect(takeThreadMessages('thread-1')).toBeUndefined();
  });

  it('forgets cached messages for a conversation', async () => {
    const fetcher = vi.fn(async () => response({ messages: [message] }));

    await loadThreadMessages(fetcher, 'thread-1');
    forgetThreadMessages('thread-1');

    expect(takeThreadMessages('thread-1')).toBeUndefined();
  });
});
