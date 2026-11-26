import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisStore = new Map<string, string>();

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: {},
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: vi.fn(async (key: string, val: string, ...args: unknown[]) => {
      if (args.includes('NX') && redisStore.has(key)) {
        return null;
      }
      redisStore.set(key, val);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      const existed = redisStore.delete(key);
      return existed ? 1 : 0;
    }),
    getdel: vi.fn(async (key: string) => {
      const val = redisStore.get(key) ?? null;
      redisStore.delete(key);
      return val;
    }),
  },
}));

import { TelegramAssistantService } from './telegram.assistant.service';

type TelegramInternals = {
  _callTelegram: (
    method: string,
    body: Record<string, unknown>
  ) => Promise<unknown>;
  _downloadTelegramPhoto: (
    fileId: string,
    organizationId: string,
    declaredSize?: number
  ) => Promise<unknown>;
  _pollLoop: () => Promise<void>;
};

describe('TelegramAssistantService', () => {
  const channels = {
    getAuthorizedLink: vi.fn(),
    handleIncomingMessage: vi.fn(),
  };
  const media = {
    saveFile: vi.fn(),
  };
  let service: TelegramAssistantService;

  beforeEach(() => {
    redisStore.clear();
    vi.clearAllMocks();
    delete process.env.TELEGRAM_ASSISTANT_POLLING;
    process.env.TELEGRAM_ASSISTANT_TOKEN = 'tg-token';
    process.env.TELEGRAM_ASSISTANT_API_BASE = 'http://telegram.test';
    service = new TelegramAssistantService(channels as never, media as never);
  });

  it('releases the update deduplication key when processing fails', async () => {
    channels.getAuthorizedLink.mockRejectedValue(
      new Error('store unavailable')
    );

    await expect(
      service.processUpdate({
        update_id: 101,
        message: {
          message_id: 1,
          from: { id: 1, username: 'alice' },
          chat: { id: 1, type: 'private' },
          text: 'Hello',
        },
      })
    ).rejects.toThrow('store unavailable');

    expect(redisStore.has('comm:tg:upd:101:processing')).toBe(false);
    expect(redisStore.has('comm:tg:upd:101:done')).toBe(false);
  });

  it('rejects a duplicate while the first update is still processing', async () => {
    redisStore.set('comm:tg:upd:103:processing', '1');

    await expect(
      service.processUpdate({
        update_id: 103,
        message: {
          message_id: 3,
          from: { id: 1, username: 'alice' },
          chat: { id: 1, type: 'private' },
          text: 'Hello again',
        },
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(channels.getAuthorizedLink).not.toHaveBeenCalled();
  });

  it('ignores an update that was already processed', async () => {
    redisStore.set('comm:tg:upd:104:done', '1');

    await service.processUpdate({
      update_id: 104,
      message: {
        message_id: 4,
        from: { id: 1, username: 'alice' },
        chat: { id: 1, type: 'private' },
        text: 'Hello once',
      },
    });

    expect(channels.getAuthorizedLink).not.toHaveBeenCalled();
  });

  it('tells the user when an incoming photo cannot be read', async () => {
    channels.getAuthorizedLink.mockResolvedValue({
      status: 'ok',
      link: {
        id: 'link-1',
        userId: 'user-1',
        organizationId: 'org-1',
        channel: 'telegram',
        externalUserId: '1',
        externalChatId: '1',
        externalUsername: 'alice',
        activeThreadId: null,
      },
    });

    const internals = service as unknown as TelegramInternals;
    const callTelegram = vi
      .spyOn(internals, '_callTelegram')
      .mockResolvedValue(true);
    vi.spyOn(internals, '_downloadTelegramPhoto').mockRejectedValue(
      new Error('Unsupported file type.')
    );

    await service.processUpdate({
      update_id: 102,
      message: {
        message_id: 2,
        from: { id: 1, username: 'alice' },
        chat: { id: 1, type: 'private' },
        caption: 'What is this?',
        photo: [{ file_id: 'photo-1', width: 1, height: 1 }],
      },
    });

    expect(callTelegram).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({
        chat_id: 1,
        text: expect.stringMatching(/image|photo/i),
      })
    );
    expect(channels.handleIncomingMessage).not.toHaveBeenCalled();
    expect(redisStore.has('comm:tg:upd:102:processing')).toBe(false);
    expect(redisStore.has('comm:tg:upd:102:done')).toBe(true);
  });

  it('removes a registered webhook before starting polling', async () => {
    process.env.TELEGRAM_ASSISTANT_POLLING = 'true';
    const internals = service as unknown as TelegramInternals;
    const callTelegram = vi
      .spyOn(internals, '_callTelegram')
      .mockResolvedValue(true);
    vi.spyOn(internals, '_pollLoop').mockResolvedValue(undefined);

    service.onModuleInit();

    await vi.waitFor(() => {
      expect(callTelegram).toHaveBeenCalledWith('deleteWebhook', {});
    });
    service.onModuleDestroy();
  });
});
