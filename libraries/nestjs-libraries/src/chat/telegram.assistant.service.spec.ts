import { ServiceUnavailableException } from '@nestjs/common';
import { CommunicationChannelLink } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  TelegramAssistantService,
  TelegramChannelsPort,
  TelegramMediaPort,
} from './telegram.assistant.service';
import type { IncomingSessionPolicy } from './communication.channels.service';

const LINK: CommunicationChannelLink = {
  id: 'link-1',
  userId: 'user-1',
  organizationId: 'org-1',
  channel: 'telegram',
  externalUserId: '1',
  externalChatId: '1',
  externalUsername: 'alice',
  activeThreadId: null,
  lastActiveAt: null,
  metadata: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('TelegramAssistantService', () => {
  const channels = {
    getAuthorizedLink: vi.fn<TelegramChannelsPort['getAuthorizedLink']>(),
    createExternalConnectToken:
      vi.fn<TelegramChannelsPort['createExternalConnectToken']>(),
    confirmWebToken: vi.fn<TelegramChannelsPort['confirmWebToken']>(),
    listThreadsForExternalUser:
      vi.fn<TelegramChannelsPort['listThreadsForExternalUser']>(),
    selectThreadForExternalUser:
      vi.fn<TelegramChannelsPort['selectThreadForExternalUser']>(),
    startNewThreadForExternalUser:
      vi.fn<TelegramChannelsPort['startNewThreadForExternalUser']>(),
    handleIncomingMessage:
      vi.fn<TelegramChannelsPort['handleIncomingMessage']>(),
    touchExternalUserActivity:
      vi.fn<TelegramChannelsPort['touchExternalUserActivity']>(),
  } satisfies TelegramChannelsPort;
  const media = {
    saveFile: vi.fn<TelegramMediaPort['saveFile']>(),
  } satisfies TelegramMediaPort;
  let service: TelegramAssistantService;

  beforeEach(() => {
    redisStore.clear();
    vi.clearAllMocks();
    delete process.env.TELEGRAM_ASSISTANT_POLLING;
    delete process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET;
    delete process.env.FRONTEND_URL;
    delete process.env.TELEGRAM_ASSISTANT_SESSION_IDLE_MINUTES;
    vi.stubEnv('NODE_ENV', 'test');
    delete process.env.NOT_SECURED;
    process.env.TELEGRAM_ASSISTANT_TOKEN = 'tg-token';
    process.env.TELEGRAM_ASSISTANT_API_BASE = 'http://telegram.test';
    service = new TelegramAssistantService(channels, media);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
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
      link: LINK,
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/getFile')) {
        return jsonResponse({
          ok: true,
          result: {
            file_id: 'photo-1',
            file_path: 'photos/bad.txt',
            file_size: 4,
          },
        });
      }
      if (url.includes('/file/bot')) {
        return new Response('nope', {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }
      if (url.endsWith('/sendMessage')) {
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

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

    const sendCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/sendMessage')
    );
    expect(sendCall).toBeTruthy();
    const body = JSON.parse(String(sendCall?.[1]?.body)) as { text?: string };
    expect(body.text).toMatch(/image|photo/i);
    expect(channels.touchExternalUserActivity).toHaveBeenCalledWith(
      'telegram',
      '1'
    );
    expect(channels.handleIncomingMessage).not.toHaveBeenCalled();
    expect(redisStore.has('comm:tg:upd:102:processing')).toBe(false);
    expect(redisStore.has('comm:tg:upd:102:done')).toBe(true);
  });

  it('removes a registered webhook before starting polling', async () => {
    process.env.TELEGRAM_ASSISTANT_POLLING = 'true';
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/deleteWebhook')) {
        return jsonResponse({ ok: true, result: true });
      }
      if (url.endsWith('/getUpdates')) {
        return jsonResponse({ ok: true, result: [] });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    service.onModuleInit();

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith('/deleteWebhook')
        )
      ).toBe(true);
    });
    service.onModuleDestroy();
  });

  it('registers the webhook only for a production HTTPS deployment', async () => {
    process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET = 'webhook-secret';
    process.env.FRONTEND_URL = 'https://postiz.example';
    vi.stubEnv('NODE_ENV', 'production');
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/setWebhook')) {
        return jsonResponse({ ok: true, result: true });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    service.onModuleInit();

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith('/setWebhook')
        )
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/setWebhook')
    );
    const body = JSON.parse(String(call?.[1]?.body)) as {
      url?: string;
      secret_token?: string;
    };
    expect(body.url).toBe(
      'https://postiz.example/api/communication-channels/telegram/webhook'
    );
    expect(body.secret_token).toBe('webhook-secret');
  });

  it('does not register the webhook for local development', async () => {
    process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET = 'webhook-secret';
    process.env.FRONTEND_URL = 'http://localhost:4200';
    vi.stubEnv('NODE_ENV', 'development');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith('/setMyCommands')
        )
      ).toBe(true);
    });

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/setWebhook'))
    ).toBe(false);
  });

  it('registers the Telegram command menu on startup', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/setMyCommands')) {
        return jsonResponse({ ok: true, result: true });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    service.onModuleInit();

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith('/setMyCommands')
        )
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/setMyCommands')
    );
    const body = JSON.parse(String(call?.[1]?.body)) as {
      commands?: Array<{ command: string }>;
    };
    expect(body.commands?.map((command) => command.command)).toEqual([
      'new',
      'chats',
      'start',
    ]);
  });

  it('does not offer a connection prompt when the account is already linked', async () => {
    channels.getAuthorizedLink.mockResolvedValue({
      status: 'ok',
      link: LINK,
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/sendMessage')) {
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.processUpdate({
      update_id: 105,
      message: {
        message_id: 5,
        from: { id: 1, username: 'alice' },
        chat: { id: 1, type: 'private' },
        text: '/start',
      },
    });

    const sendCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/sendMessage')
    );
    const body = JSON.parse(String(sendCall?.[1]?.body)) as {
      text?: string;
      reply_markup?: unknown;
    };
    expect(body.text).toMatch(/already connected/i);
    expect(body.reply_markup).toBeUndefined();
    expect(channels.touchExternalUserActivity).toHaveBeenCalledWith(
      'telegram',
      '1'
    );
  });

  it('keeps the typing indicator alive until the assistant replies', async () => {
    channels.getAuthorizedLink.mockResolvedValue({
      status: 'ok',
      link: LINK,
    });
    let resolveReply!: (
      value: Awaited<ReturnType<TelegramChannelsPort['handleIncomingMessage']>>
    ) => void;
    channels.handleIncomingMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveReply = resolve;
      })
    );
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/sendChatAction')) {
        return jsonResponse({ ok: true, result: true });
      }
      if (url.endsWith('/sendMessage')) {
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const pending = service.processUpdate({
      update_id: 106,
      message: {
        message_id: 6,
        from: { id: 1, username: 'alice' },
        chat: { id: 1, type: 'private' },
        text: 'Hello',
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const typingCalls = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/sendChatAction')
      ).length;
    const initial = typingCalls();

    await vi.advanceTimersByTimeAsync(8000);

    expect(typingCalls()).toBeGreaterThan(initial);
    resolveReply({
      status: 'ok',
      threadId: 'thread-1',
      text: 'Reply',
      generatedImages: [],
    });
    await pending;
  });

  it('wires the idle policy to the configured window and the link chat', async () => {
    channels.getAuthorizedLink.mockResolvedValue({
      status: 'ok',
      link: { ...LINK, externalChatId: '777' },
    });
    let capturedPolicy: IncomingSessionPolicy | undefined;
    channels.handleIncomingMessage.mockImplementation(
      async (_channel, _externalUserId, _messageText, sessionPolicy) => {
        capturedPolicy = sessionPolicy;
        await sessionPolicy?.onIdleReset('777');
        return {
          status: 'ok',
          threadId: 'thread-1',
          text: 'Reply',
          generatedImages: [],
        };
      }
    );
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/sendChatAction')) {
        return jsonResponse({ ok: true, result: true });
      }
      if (url.endsWith('/sendMessage')) {
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.processUpdate({
      update_id: 107,
      message: {
        message_id: 7,
        from: { id: 1, username: 'alice' },
        chat: { id: 1, type: 'private' },
        text: 'Hello',
      },
    });

    const now = new Date('2026-01-01T12:00:00.000Z');
    const messages = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/sendMessage'))
      .map(
        ([, init]) =>
          JSON.parse(String(init?.body)) as {
            chat_id?: string | number;
            text?: string;
            parse_mode?: string;
          }
      );
    expect(
      capturedPolicy?.shouldReset(new Date('2026-01-01T11:00:00.000Z'), now)
    ).toBe(true);
    expect(
      capturedPolicy?.shouldReset(new Date('2026-01-01T11:00:01.000Z'), now)
    ).toBe(false);
    expect(messages[0]).toEqual({
      chat_id: '777',
      text: '<i>New session started after inactivity.\nPrevious chats: /chats</i>',
      parse_mode: 'HTML',
    });
  });

  it('touches link activity on the chats command without an idle notice', async () => {
    channels.getAuthorizedLink.mockResolvedValue({
      status: 'ok',
      link: LINK,
    });
    channels.listThreadsForExternalUser.mockResolvedValue([]);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/sendMessage')) {
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.processUpdate({
      update_id: 108,
      message: {
        message_id: 8,
        from: { id: 1, username: 'alice' },
        chat: { id: 1, type: 'private' },
        text: '/chats',
      },
    });

    expect(channels.touchExternalUserActivity).toHaveBeenCalledWith(
      'telegram',
      '1'
    );
    expect(channels.handleIncomingMessage).not.toHaveBeenCalled();
    const sendCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/sendMessage')
    );
    const body = JSON.parse(String(sendCall?.[1]?.body)) as { text?: string };
    expect(body.text).toMatch(/no chats yet/i);
  });

  it('[TC-2-31-1] sends a system notice when the assistant returns empty text', async () => {
    channels.getAuthorizedLink.mockResolvedValue({
      status: 'ok',
      link: LINK,
    });
    channels.handleIncomingMessage.mockResolvedValue({
      status: 'ok',
      threadId: 'thread-1',
      text: '',
      generatedImages: [],
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/sendChatAction')) {
        return jsonResponse({ ok: true, result: true });
      }
      if (url.endsWith('/sendMessage')) {
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      throw new Error(`Unexpected Telegram call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.processUpdate({
      update_id: 110,
      message: {
        message_id: 10,
        from: { id: 1, username: 'alice', language_code: 'uk' },
        chat: { id: 1, type: 'private' },
        text: 'Delete the scheduled post',
      },
    });

    const sentTexts: unknown[] = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/sendMessage'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    const texts = sentTexts.flatMap((body) =>
      typeof body === 'object' &&
      body !== null &&
      'text' in body &&
      typeof body.text === 'string'
        ? [body.text]
        : []
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('<i>');
    expect(texts[0]).toContain('Не вдалося');
  });
});
