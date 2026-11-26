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

import { CommunicationChannelLink } from '@prisma/client';
import {
  AgentRuntimePort,
  CommunicationChannelsRepositoryPort,
  CommunicationChannelsService,
  MastraPort,
  MembershipPort,
  SubscriptionPort,
} from './communication.channels.service';

const LINK: CommunicationChannelLink = {
  id: 'link-1',
  userId: 'user-1',
  organizationId: 'org-1',
  channel: 'telegram',
  externalUserId: '123',
  externalChatId: '123',
  externalUsername: 'alice',
  activeThreadId: null,
  metadata: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const MEMBERSHIP: MembershipPort = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'ADMIN',
  organization: {
    id: 'org-1',
    name: 'Org 1',
    createdAt: new Date(0),
    subscription: null,
  },
};

describe('CommunicationChannelsService', () => {
  const repository = {
    findByExternalUser: vi.fn<
      CommunicationChannelsRepositoryPort['findByExternalUser']
    >(),
    findByUserAndOrg: vi.fn<
      CommunicationChannelsRepositoryPort['findByUserAndOrg']
    >(),
    upsertLink: vi.fn<CommunicationChannelsRepositoryPort['upsertLink']>(),
    updateActiveThread: vi.fn<
      CommunicationChannelsRepositoryPort['updateActiveThread']
    >(),
    deleteByUserAndOrg: vi.fn<
      CommunicationChannelsRepositoryPort['deleteByUserAndOrg']
    >(),
    findMembership: vi.fn<
      CommunicationChannelsRepositoryPort['findMembership']
    >(),
  } satisfies CommunicationChannelsRepositoryPort;

  const subscriptionService = {
    getSubscriptionByOrganizationId: vi.fn<
      SubscriptionPort['getSubscriptionByOrganizationId']
    >(),
  } satisfies SubscriptionPort;

  const mastraService = {
    mastra: vi.fn<MastraPort['mastra']>(),
  } satisfies MastraPort;

  const agentRuntime = {
    prepare: vi.fn<AgentRuntimePort['prepare']>(),
  } satisfies AgentRuntimePort;

  let service: CommunicationChannelsService;

  beforeEach(() => {
    redisStore.clear();
    vi.clearAllMocks();
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.TELEGRAM_ASSISTANT_TOKEN = 'tg-token';
    process.env.TELEGRAM_ASSISTANT_BOT_NAME = 'postiz_test_bot';
    process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET = 'webhook-secret';
    delete process.env.TELEGRAM_ASSISTANT_POLLING;
    service = new CommunicationChannelsService(
      repository,
      subscriptionService,
      mastraService,
      agentRuntime
    );
  });

  it('creates one-time connect link and rejects second consumption', async () => {
    repository.findMembership.mockResolvedValue(MEMBERSHIP);
    repository.upsertLink.mockResolvedValue({
      ...LINK,
      externalUserId: '123',
      externalChatId: '123',
      externalUsername: 'alice',
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
    repository.findMembership.mockResolvedValue(MEMBERSHIP);
    repository.upsertLink.mockResolvedValue({
      ...LINK,
      externalUserId: '555',
      externalChatId: '555',
      externalUsername: 'bob',
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
      ...LINK,
      externalUserId: '555',
      externalChatId: '555',
      externalUsername: 'bob',
    });
    repository.findMembership.mockResolvedValue(null);

    const res = await service.handleIncomingMessage('telegram', '555', 'hello');
    expect(res).toEqual({ status: 'unauthorized' });
  });

  it('requires a delivery transport before reporting Telegram as configured', () => {
    delete process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET;
    expect(service.isChannelConfigured('telegram')).toBe(false);

    process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET = 'webhook-secret';
    expect(service.isChannelConfigured('telegram')).toBe(true);

    delete process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET;
    process.env.TELEGRAM_ASSISTANT_POLLING = 'true';
    expect(service.isChannelConfigured('telegram')).toBe(true);
  });

  it('shows the pending Telegram account without consuming the token', async () => {
    repository.findMembership.mockResolvedValue(MEMBERSHIP);
    repository.upsertLink.mockResolvedValue({
      ...LINK,
      externalUserId: '777',
      externalChatId: '777',
      externalUsername: 'alice',
    });

    const token = await service.createExternalConnectToken('telegram', {
      externalUserId: '777',
      externalChatId: '777',
      externalUsername: 'alice',
    });

    await expect(
      service.getExternalConnectPreview('telegram', token)
    ).resolves.toEqual({ username: 'alice' });
    await expect(
      service.getExternalConnectPreview('telegram', token)
    ).resolves.toEqual({ username: 'alice' });

    await service.confirmExternalToken('user-1', 'org-1', 'telegram', token);

    await expect(
      service.getExternalConnectPreview('telegram', token)
    ).resolves.toBeNull();
  });

  it('rejects a preview for an unknown token', async () => {
    await expect(
      service.getExternalConnectPreview('telegram', '0123456789abcdef')
    ).resolves.toBeNull();
  });

  it('passes full organization subscription and user role into RequestContext', async () => {
    repository.findByExternalUser.mockResolvedValue({
      id: 'link-1',
      userId: 'user-1',
      organizationId: 'org-1',
      channel: 'telegram',
      externalUserId: '555',
      externalChatId: '555',
      externalUsername: 'bob',
      activeThreadId: null,
      metadata: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    repository.findMembership.mockResolvedValue({
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'USER',
      organization: {
        id: 'org-1',
        name: 'Org 1',
        createdAt: new Date(0),
        subscription: { subscriptionTier: 'PRO' },
      },
    });
    repository.updateActiveThread.mockResolvedValue({
      id: 'link-1',
      userId: 'user-1',
      organizationId: 'org-1',
      channel: 'telegram',
      externalUserId: '555',
      externalChatId: '555',
      externalUsername: 'bob',
      activeThreadId: 'thread-1',
      metadata: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const streamMock = vi.fn<
      (
        msg: string,
        opts: {
          memory: { thread: string; resource: string };
          requestContext: { getRaw: (k: string) => unknown };
        }
      ) => Promise<{ text: Promise<string>; steps: Promise<unknown> }>
    >(async (_msg, opts) => {
      const org = JSON.parse(
        String(opts.requestContext.getRaw('organization'))
      );
      expect(org.subscription.subscriptionTier).toBe('PRO');
      expect(org.users).toEqual([{ role: 'USER' }]);
      return {
        text: Promise.resolve('ok'),
        steps: Promise.resolve([]),
      };
    });
    mastraService.mastra.mockResolvedValue({
      getAgent: () => ({
        getMemory: async () => undefined,
        stream: streamMock,
      }),
    });
    agentRuntime.prepare.mockResolvedValue({
      applyTo: () => undefined,
      release: async () => undefined,
    });

    const res = await service.handleIncomingMessage('telegram', '555', 'hello');
    expect(res.status).toBe('ok');
    expect(streamMock).toHaveBeenCalledTimes(1);
  });
});
