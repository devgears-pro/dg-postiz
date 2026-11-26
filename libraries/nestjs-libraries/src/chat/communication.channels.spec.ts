import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

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

import { CommunicationChannelsService } from './communication.channels.service';

describe('CommunicationChannelsService', () => {
  const repository = {
    findByExternalUser: vi.fn(),
    findByUserAndOrg: vi.fn(),
    upsertLink: vi.fn(),
    updateActiveThread: vi.fn(),
    deleteByUserAndOrg: vi.fn(),
    findMembership: vi.fn(),
  };

  const subscriptionService = {
    getSubscriptionByOrganizationId: vi.fn(),
  };

  const mastraService = {
    mastra: vi.fn(),
  };

  const agentRuntime = {
    prepare: vi.fn(),
  };

  let service: CommunicationChannelsService;

  beforeEach(() => {
    redisStore.clear();
    vi.clearAllMocks();
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.TELEGRAM_ASSISTANT_TOKEN = 'tg-token';
    process.env.TELEGRAM_ASSISTANT_BOT_NAME = 'postiz_test_bot';
    service = new CommunicationChannelsService(
      repository as never,
      subscriptionService as never,
      mastraService as never,
      agentRuntime as never
    );
  });

  it('creates one-time connect link and rejects second consumption', async () => {
    repository.findMembership.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { id: 'org-1', name: 'Org 1', createdAt: new Date() },
    });
    repository.upsertLink.mockResolvedValue({
      id: 'link-1',
      userId: 'user-1',
      organizationId: 'org-1',
      channel: 'telegram',
      externalUserId: '123',
      externalChatId: '123',
      externalUsername: 'alice',
      activeThreadId: null,
    });

    const link = await service.createWebConnectLink(
      'user-1',
      'org-1',
      'telegram'
    );
    expect(link.url).toContain('https://t.me/postiz_test_bot?start=');
    const token = link.url.split('?start=')[1];

    const first = await service.confirmWebToken('telegram', token, {
      externalUserId: '123',
      externalChatId: '123',
      externalUsername: 'alice',
    });
    expect(first?.organizationId).toBe('org-1');

    const second = await service.confirmWebToken('telegram', token, {
      externalUserId: '123',
      externalChatId: '123',
      externalUsername: 'alice',
    });
    expect(second).toBeNull();
  });

  it('rejects connection confirmation when user is not an active member', async () => {
    repository.findMembership.mockResolvedValue(null);
    await expect(
      service.confirmExternalToken(
        'user-1',
        'org-2',
        'telegram',
        '0123456789abcdef'
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('consumes external token only once', async () => {
    repository.findMembership.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      organization: { id: 'org-1', name: 'Org 1', createdAt: new Date() },
    });
    repository.upsertLink.mockResolvedValue({
      id: 'link-1',
      userId: 'user-1',
      organizationId: 'org-1',
      channel: 'telegram',
      externalUserId: '555',
      externalChatId: '555',
      externalUsername: 'bob',
      activeThreadId: null,
    });

    const token = await service.createExternalConnectToken('telegram', {
      externalUserId: '555',
      externalChatId: '555',
      externalUsername: 'bob',
    });

    const linked = await service.confirmExternalToken(
      'user-1',
      'org-1',
      'telegram',
      token
    );
    expect(linked.externalUserId).toBe('555');

    await expect(
      service.confirmExternalToken('user-1', 'org-1', 'telegram', token)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks incoming message if organization membership was revoked', async () => {
    repository.findByExternalUser.mockResolvedValue({
      id: 'link-1',
      userId: 'user-1',
      organizationId: 'org-1',
      channel: 'telegram',
      externalUserId: '555',
      externalChatId: '555',
      externalUsername: 'bob',
      activeThreadId: null,
    });
    repository.findMembership.mockResolvedValue(null);

    const res = await service.handleIncomingMessage('telegram', '555', 'hello');
    expect(res).toEqual({ status: 'unauthorized' });
  });
});
